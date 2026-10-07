// The receipt logic against a live Postgres and the real local driver (on a
// throwaway root): who may upload, what the first receipt does to the order —
// exactly once, however many arrive together — what the cap holds, what a
// refused upload leaves behind (nothing), and who may read a receipt back.
//
// The admin alert is recorded, not sent: its own suites prove what it says and
// that it never fails its caller. Here it is only counted.
//
// Needs a live database — see src/db/test-db.ts.
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { integer, pgSchema } from 'drizzle-orm/pg-core';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { orders, paymentReceipts } from '@/db/schema/orders';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type OrderStatus,
  type PaymentMethod,
} from '@/lib/orders/order-status';
import { MAX_RECEIPTS_PER_ORDER } from '@/lib/orders/receipt';
import { VARS } from '@/lib/utils/env';

const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock('@/logic/orders/notify-new-order', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/logic/orders/notify-new-order')>()),
  notifyAdminsOfNewOrder: mocks.notify,
}));
vi.mock('@sentry/nextjs', () => ({
  captureMessage: mocks.captureMessage,
  captureException: mocks.captureException,
}));

const { receiptUploadGate, uploadReceipt, readReceipt } = await importWithDb(
  () => import('@/logic/orders/receipts'),
);
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { PaymentDao } = await importWithDb(() => import('@/db/dao/PaymentDao'));
const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));
const { ReceiptDao } = await importWithDb(() => import('@/db/dao/ReceiptDao'));
const { transitionOrder } = await importWithDb(
  () => import('@/logic/orders/state-machine'),
);
const { localDriver } = await import('@/lib/storage/local-driver');

/** A real JPEG header, padded: the bytes are what gets sniffed and stored. */
const jpeg = (size = 64) => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
};

let root: string;
const originalRoot = process.env[VARS.APP_CONFIG_STORAGE_LOCAL_ROOT];

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'smokey-receipts-'));
  process.env[VARS.APP_CONFIG_STORAGE_LOCAL_ROOT] = root;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  if (originalRoot === undefined) {
    delete process.env[VARS.APP_CONFIG_STORAGE_LOCAL_ROOT];
  } else {
    process.env[VARS.APP_CONFIG_STORAGE_LOCAL_ROOT] = originalRoot;
  }
});

// Postgres's own view of its sessions, for `holdOrderRow` below.
const pgStatActivity = pgSchema('pg_catalog').table('pg_stat_activity', {
  pid: integer('pid'),
});

/**
 * Holds `orderId`'s row until `release()`, so a race between uploads is
 * certain rather than likely: start them, wait until `blockedBehind()` counts
 * them all, let go. It counts only the sessions this holder blocks, never a
 * lock anyone else holds: those with its backend pid among their
 * `pg_blocking_pids`, and those queued behind one of them — two sessions
 * waiting for one row queue on its tuple lock, so the second is blocked by
 * the first, not by the holder.
 */
const holdOrderRow = async (orderId: string) => {
  let letGo = () => {};
  const released = new Promise<void>((resolve) => (letGo = resolve));
  let holding = () => {};
  const held = new Promise<void>((resolve) => (holding = resolve));
  let pid = 0;
  const done = testDb.transaction(async (tx) => {
    const { rows } = await tx.execute<{ pid: number }>(
      sql`select pg_backend_pid() as pid`,
    );
    pid = rows[0].pid;
    await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update');
    holding();
    await released;
  });
  await held;
  return {
    blockedBehind: () =>
      testDb.$count(
        pgStatActivity,
        sql`${pid} = any(pg_blocking_pids(${pgStatActivity.pid})) or exists (select 1 from unnest(pg_blocking_pids(${pgStatActivity.pid})) as blocker(pid) where ${pid} = any(pg_blocking_pids(blocker.pid)))`,
      ),
    release: async () => {
      letGo();
      await done;
    },
  };
};

/** The receipt files on disk right now. */
const storedFiles = async () =>
  readdir(path.join(root, 'receipts')).catch(() => [] as string[]);

describe.skipIf(!databaseReachable)('card-to-card receipts', () => {
  const fx = new OrderFixtures();

  beforeEach(() => {
    mocks.notify.mockClear();
    mocks.captureMessage.mockClear();
    mocks.captureException.mockClear();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fx.cleanup();
    await rm(path.join(root, 'receipts'), { recursive: true, force: true });
  });

  /** An order as checkout leaves it: stock reserved, the COD row pending. */
  const placed = async (
    status: OrderStatus = ORDER_STATUSES.AWAITING_RECEIPT,
    paymentMethod: PaymentMethod = PAYMENT_METHODS.COD,
  ) => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 10 });
    await ProductDao.decrementStock(testDb, product.id, 1);
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 1 }], { status, paymentMethod }),
    );
    fx.remember(order.id);
    if (paymentMethod === PAYMENT_METHODS.COD) {
      await PaymentDao.create({
        orderId: order.id,
        method: PAYMENT_METHODS.COD,
        amount: order.total,
      });
    }
    return { user, order };
  };

  const statusOf = async (id: string) =>
    (
      await testDb
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, id))
    )[0].status;

  const receiptRows = (orderId: string) =>
    testDb
      .select()
      .from(paymentReceipts)
      .where(eq(paymentReceipts.orderId, orderId));

  describe('receiptUploadGate', () => {
    it('lets the owner of a waiting card-to-card order through', async () => {
      const { user, order } = await placed();
      const gate = await receiptUploadGate(order.id, user.id);
      expect(gate.outcome).toBe('ok');
    });

    it('answers another customer exactly as it answers a missing order', async () => {
      const { order } = await placed();
      const stranger = await fx.user();

      expect(await receiptUploadGate(order.id, stranger.id)).toEqual({
        outcome: 'not_found',
      });
      expect(await receiptUploadGate(crypto.randomUUID(), stranger.id)).toEqual(
        { outcome: 'not_found' },
      );
    });

    it.each([
      [ORDER_STATUSES.PENDING_PAYMENT, PAYMENT_METHODS.ZARINPAL],
      [ORDER_STATUSES.PROCESSING, PAYMENT_METHODS.ZARINPAL],
      [ORDER_STATUSES.SHIPPED, PAYMENT_METHODS.COD],
      [ORDER_STATUSES.DELIVERED, PAYMENT_METHODS.COD],
      [ORDER_STATUSES.CANCELLED, PAYMENT_METHODS.COD],
    ] as const)(
      'refuses a %s %s order its owner uploads to',
      async (status, method) => {
        const { user, order } = await placed(status, method);
        expect(await receiptUploadGate(order.id, user.id)).toEqual({
          outcome: 'not_accepting',
        });
      },
    );

    it('refuses the sixth receipt before the body is read', async () => {
      const { user, order } = await placed(ORDER_STATUSES.PROCESSING);
      for (let i = 0; i < MAX_RECEIPTS_PER_ORDER; i++) {
        await uploadReceipt(order.id, order.userId, jpeg(), 'image/jpeg');
      }
      expect(await receiptUploadGate(order.id, user.id)).toEqual({
        outcome: 'cap_reached',
      });
    });
  });

  describe('uploadReceipt', () => {
    it('stores the first receipt, accepts the order and tells the admins once', async () => {
      const { order } = await placed();

      const result = await uploadReceipt(
        order.id,
        order.userId,
        jpeg(100),
        'image/jpeg',
      );

      if (result.outcome !== 'ok') throw new Error(result.outcome);
      expect(result.accepted).toBe(true);
      expect(await statusOf(order.id)).toBe(ORDER_STATUSES.PROCESSING);

      const [row] = await receiptRows(order.id);
      expect(row.id).toBe(result.receipt.id);
      expect(row.objectKey).toMatch(/^receipts\/[0-9a-f-]{36}\.jpg$/);
      expect(row.contentType).toBe('image/jpeg');
      expect(row.size).toBe(100);
      expect(await localDriver.get(row.objectKey)).toEqual(jpeg(100));

      expect(mocks.notify).toHaveBeenCalledTimes(1);
      expect(mocks.notify).toHaveBeenCalledWith(order.id);
    });

    it('books nothing at acceptance — the payment flips once the admin ships it', async () => {
      const { order } = await placed();
      await uploadReceipt(order.id, order.userId, jpeg(), 'image/jpeg');

      const [before] = await PaymentDao.listByOrder(order.id);
      expect(before.status).toBe(PAYMENT_STATUSES.PENDING);

      // Shipping is the admin's word that the receipt checked out.
      await testDb.transaction((tx) =>
        transitionOrder(
          tx,
          order.id,
          ORDER_STATUSES.PROCESSING,
          ORDER_STATUSES.SHIPPED,
        ),
      );
      const [after] = await PaymentDao.listByOrder(order.id);
      expect(after.status).toBe(PAYMENT_STATUSES.PAID);
    });

    it('keeps a later receipt without touching the order or telling anyone', async () => {
      const { order } = await placed();
      await uploadReceipt(order.id, order.userId, jpeg(), 'image/jpeg');
      mocks.notify.mockClear();

      const second = await uploadReceipt(
        order.id,
        order.userId,
        jpeg(),
        'image/png',
      );

      expect(second).toMatchObject({ outcome: 'ok', accepted: false });
      expect(await statusOf(order.id)).toBe(ORDER_STATUSES.PROCESSING);
      expect(await receiptRows(order.id)).toHaveLength(2);
      expect(mocks.notify).not.toHaveBeenCalled();
    });

    it('accepts the order exactly once when two first receipts arrive together, keeping both', async () => {
      const { order } = await placed();

      // "Together" made certain: both uploads are stuck behind the held row
      // before either can read the order, so the one that loses must find it
      // already accepted and still keep its receipt.
      const row = await holdOrderRow(order.id);
      const uploads = Promise.all([
        uploadReceipt(order.id, order.userId, jpeg(), 'image/jpeg'),
        uploadReceipt(order.id, order.userId, jpeg(), 'image/jpeg'),
      ]);
      try {
        await vi.waitFor(
          async () => expect(await row.blockedBehind()).toBe(2),
          { timeout: 10_000, interval: 25 },
        );
      } finally {
        await row.release();
      }
      const results = await uploads;

      expect(results.map((r) => r.outcome)).toEqual(['ok', 'ok']);
      expect(
        results.filter((r) => r.outcome === 'ok' && r.accepted),
      ).toHaveLength(1);
      expect(await statusOf(order.id)).toBe(ORDER_STATUSES.PROCESSING);
      expect(await receiptRows(order.id)).toHaveLength(2);
      expect(mocks.notify).toHaveBeenCalledTimes(1);
    });

    it('refuses a stranger’s upload under the lock, even with the gate skipped', async () => {
      // The route's gate is the fast path; the store is the one that holds.
      const { order } = await placed();
      const stranger = await fx.user();

      expect(
        await uploadReceipt(order.id, stranger.id, jpeg(), 'image/jpeg'),
      ).toEqual({ outcome: 'not_found' });

      expect(await receiptRows(order.id)).toHaveLength(0);
      expect(await storedFiles()).toEqual([]);
      expect(await statusOf(order.id)).toBe(ORDER_STATUSES.AWAITING_RECEIPT);
      expect(mocks.notify).not.toHaveBeenCalled();
    });

    it('never adds a receipt to a Zarinpal order', async () => {
      const { order } = await placed(
        ORDER_STATUSES.PROCESSING,
        PAYMENT_METHODS.ZARINPAL,
      );

      expect(
        await uploadReceipt(order.id, order.userId, jpeg(), 'image/jpeg'),
      ).toEqual({
        outcome: 'not_accepting',
      });
      expect(await receiptRows(order.id)).toHaveLength(0);
      expect(await storedFiles()).toEqual([]);
    });

    it.each([ORDER_STATUSES.CANCELLED, ORDER_STATUSES.SHIPPED])(
      'stores nothing — no row, no file — once the order is %s',
      async (status) => {
        // The gate saw it open; the order moved before the bytes arrived.
        const { order } = await placed(status);

        expect(
          await uploadReceipt(order.id, order.userId, jpeg(), 'image/jpeg'),
        ).toEqual({
          outcome: 'not_accepting',
        });
        expect(await receiptRows(order.id)).toHaveLength(0);
        expect(await storedFiles()).toEqual([]);
        expect(mocks.notify).not.toHaveBeenCalled();
      },
    );

    it('holds the cap when the last slots are raced, leaving no stray file', async () => {
      const { order } = await placed(ORDER_STATUSES.PROCESSING);
      for (let i = 0; i < MAX_RECEIPTS_PER_ORDER - 1; i++) {
        await uploadReceipt(order.id, order.userId, jpeg(), 'image/jpeg');
      }

      // Both are stuck behind the held row before either counts the
      // receipts, so both would see room for one more without the lock.
      const row = await holdOrderRow(order.id);
      const uploads = Promise.all([
        uploadReceipt(order.id, order.userId, jpeg(), 'image/jpeg'),
        uploadReceipt(order.id, order.userId, jpeg(), 'image/jpeg'),
      ]);
      try {
        await vi.waitFor(
          async () => expect(await row.blockedBehind()).toBe(2),
          { timeout: 10_000, interval: 25 },
        );
      } finally {
        await row.release();
      }
      const results = await uploads;

      expect(results.map((r) => r.outcome).sort()).toEqual([
        'cap_reached',
        'ok',
      ]);
      expect(await receiptRows(order.id)).toHaveLength(MAX_RECEIPTS_PER_ORDER);
      expect(await storedFiles()).toHaveLength(MAX_RECEIPTS_PER_ORDER);
    });

    it('reports a failed clean-up by its code alone — never the key or the path', async () => {
      // Refused after the object is written, and the clean-up delete then
      // fails with the error a filesystem gives: its message names the file.
      const { order } = await placed();
      vi.spyOn(ReceiptDao, 'insertUnderCap').mockResolvedValue(null);
      const leaky = Object.assign(
        new Error(
          `EACCES: permission denied, unlink '${root}/receipts/secret-key.jpg'`,
        ),
        { code: 'EACCES' },
      );
      vi.spyOn(localDriver, 'delete').mockRejectedValue(leaky);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(
        await uploadReceipt(order.id, order.userId, jpeg(), 'image/jpeg'),
      ).toEqual({ outcome: 'cap_reached' });

      expect(mocks.captureException).not.toHaveBeenCalled();
      expect(mocks.captureMessage).toHaveBeenCalledWith(
        '[receipts] removing a refused receipt failed',
        { extra: { orderId: order.id, code: 'EACCES' } },
      );
      const said = JSON.stringify([
        warn.mock.calls,
        mocks.captureMessage.mock.calls,
      ]);
      expect(said).not.toContain('receipts/');
      expect(said).not.toContain(root);
    });

    it('takes the stored file back out when the database write throws', async () => {
      // A receipt is someone's bank details: one the database never recorded
      // must not stay in storage with nothing that could ever find it.
      const { order } = await placed();
      const failure = new Error('connection reset');
      vi.spyOn(ReceiptDao, 'insertUnderCap').mockRejectedValue(failure);

      await expect(
        uploadReceipt(order.id, order.userId, jpeg(), 'image/jpeg'),
      ).rejects.toBe(failure);

      expect(await storedFiles()).toEqual([]);
      expect(await statusOf(order.id)).toBe(ORDER_STATUSES.AWAITING_RECEIPT);
    });
  });

  describe('readReceipt', () => {
    const stored = async () => {
      const placedOrder = await placed();
      const result = await uploadReceipt(
        placedOrder.order.id,
        placedOrder.order.userId,
        jpeg(80),
        'image/jpeg',
      );
      if (result.outcome !== 'ok') throw new Error(result.outcome);
      return { ...placedOrder, receiptId: result.receipt.id };
    };

    it('gives the owner the bytes and their sniffed type', async () => {
      const { user, order, receiptId } = await stored();

      expect(
        await readReceipt(order.id, receiptId, { userId: user.id }),
      ).toEqual({ contentType: 'image/jpeg', bytes: jpeg(80) });
    });

    it('gives an admin the same', async () => {
      const { order, receiptId } = await stored();
      expect(await readReceipt(order.id, receiptId, 'admin')).toEqual({
        contentType: 'image/jpeg',
        bytes: jpeg(80),
      });
    });

    it('gives another customer nothing — the same nothing as a missing receipt', async () => {
      const { order, receiptId } = await stored();
      const stranger = await fx.user();

      expect(
        await readReceipt(order.id, receiptId, { userId: stranger.id }),
      ).toBeNull();
      expect(
        await readReceipt(order.id, crypto.randomUUID(), {
          userId: stranger.id,
        }),
      ).toBeNull();
    });

    it('never reads one order’s receipt through another order, even the owner’s own', async () => {
      const first = await stored();
      const second = await placed();
      await testDb
        .update(orders)
        .set({ userId: first.user.id })
        .where(eq(orders.id, second.order.id));

      expect(
        await readReceipt(second.order.id, first.receiptId, {
          userId: first.user.id,
        }),
      ).toBeNull();
      expect(
        await readReceipt(second.order.id, first.receiptId, 'admin'),
      ).toBeNull();
    });

    it('answers null when the stored object is gone', async () => {
      const { user, order, receiptId } = await stored();
      const [row] = await receiptRows(order.id);
      await localDriver.delete(row.objectKey);

      expect(
        await readReceipt(order.id, receiptId, { userId: user.id }),
      ).toBeNull();
    });

    it('never widens the owner read into the admin read for a missing user', async () => {
      // Two reads, not one with an optional owner: a caller that loses the
      // user id gets nothing, where a default could have given everyone's.
      const { user, order, receiptId } = await stored();
      const lost = undefined as unknown as string;

      expect(
        await ReceiptDao.getOwnedForOrder(receiptId, order.id, lost),
      ).toBeNull();
      expect(
        (await ReceiptDao.getOwnedForOrder(receiptId, order.id, user.id))?.id,
      ).toBe(receiptId);
      expect(
        (await ReceiptDao.getForOrderAsAdmin(receiptId, order.id))?.id,
      ).toBe(receiptId);
    });
  });
});
