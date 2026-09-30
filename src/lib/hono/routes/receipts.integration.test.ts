// The receipt routes, driven through the real Hono `app` — so they prove the
// mounts in ../index.ts (the session guard and the body limit run before every
// handler) as much as the handlers: who may upload and read a receipt, what a
// stranger learns (nothing: 404, the same as a missing receipt), what every
// refusal leaves in storage (nothing), and the headers that keep a receipt out
// of every cache. Only the session lookup is mocked; storage is the real local
// driver on a throwaway root.
//
// Needs a live database — see src/db/test-db.ts.
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { orders, paymentReceipts } from '@/db/schema/orders';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import {
  API_PATHS,
  apiAdminOrderReceiptPath,
  apiOrderReceiptPath,
  apiOrderReceiptsPath,
} from '@/lib/constant/paths';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type OrderStatus,
  type PaymentMethod,
} from '@/lib/orders/order-status';
import {
  MAX_RECEIPT_BYTES,
  MAX_RECEIPTS_PER_ORDER,
  RECEIPT_CAP_MESSAGE,
} from '@/lib/orders/receipt';
import { IMAGE_FIELD_NAME } from '@/lib/storage/image-upload';
import { VARS } from '@/lib/utils/env';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ isAuthenticatedUser: mocks.getSession }));

const { app } = await importWithDb(() => import('@/lib/hono'));
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { localDriver } = await import('@/lib/storage/local-driver');
const { ReceiptExposedError } = await import('@/lib/storage');
const {
  IMAGE_TOO_LARGE_MESSAGE,
  INVALID_IMAGE_MESSAGE,
  NO_IMAGE_FILE_MESSAGE,
} = await import('@/lib/hono/image-upload');

const jpeg = (size = 64): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(new ArrayBuffer(size));
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
};
/** `%PDF-1.7`: a PDF, whatever its name and declared type say. */
const pdf = (): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(new ArrayBuffer(64));
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
  return bytes;
};

const as = (id: string, role: 'customer' | 'admin' = 'customer') =>
  mocks.getSession.mockResolvedValue({
    user: { id, email: `${role}@example.com`, role },
    session: { id: `s-${id}` },
  });
const anon = () => mocks.getSession.mockResolvedValue(null);

let root: string;
const originalRoot = process.env[VARS.APP_CONFIG_STORAGE_LOCAL_ROOT];

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'smokey-receipt-routes-'));
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

const storedFiles = () =>
  readdir(path.join(root, 'receipts')).catch(() => [] as string[]);

const upload = (orderId: string, file?: File) => {
  const form = new FormData();
  if (file) form.set(IMAGE_FIELD_NAME, file);
  return app.request(apiOrderReceiptsPath(orderId), {
    method: 'POST',
    body: form,
  });
};

const receiptFile = (bytes = jpeg(), name = 'رسید.jpg', type = 'image/jpeg') =>
  new File([bytes], name, { type });

/** A refusal: the status and the exact envelope. */
const expectRefusal = async (
  response: Response | Promise<Response>,
  status: number,
  message: string,
) => {
  const res = await response;
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ status: 'error', message });
};

describe.skipIf(!databaseReachable)('receipt routes', () => {
  const fx = new OrderFixtures();

  afterEach(async () => {
    mocks.getSession.mockReset();
    vi.restoreAllMocks();
    await fx.cleanup();
    await rm(path.join(root, 'receipts'), { recursive: true, force: true });
  });

  const placed = async (
    status: OrderStatus = ORDER_STATUSES.AWAITING_RECEIPT,
    paymentMethod: PaymentMethod = PAYMENT_METHODS.COD,
  ) => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 10 });
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 1 }], { status, paymentMethod }),
    );
    fx.remember(order.id);
    return { user, order };
  };

  /** An order of `user`'s with one receipt on it, uploaded as that user. */
  const withReceipt = async () => {
    const { user, order } = await placed();
    as(user.id);
    const res = await upload(order.id, receiptFile(jpeg(90)));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    mocks.getSession.mockReset();
    return { user, order, receiptId: body.data.id };
  };

  const rows = (orderId: string) =>
    testDb
      .select()
      .from(paymentReceipts)
      .where(eq(paymentReceipts.orderId, orderId));

  describe('POST /orders/{id}/receipts', () => {
    it('stores the owner’s receipt and answers with its id and time only', async () => {
      const { user, order } = await placed();
      as(user.id);

      const res = await upload(order.id, receiptFile());

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        status: string;
        data: Record<string, unknown>;
      };
      expect(body.status).toBe('success');
      expect(Object.keys(body.data).sort()).toEqual(['createdAt', 'id']);
      expect(await rows(order.id)).toHaveLength(1);
      const [status] = await testDb
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, order.id));
      expect(status.status).toBe(ORDER_STATUSES.PROCESSING);
    });

    it('answers 401 without a session — exactly, and before anything is stored', async () => {
      const { order } = await placed();
      anon();

      const res = await upload(order.id, receiptFile());

      expect(res.status).toBe(401);
      expect(await rows(order.id)).toHaveLength(0);
      expect(await storedFiles()).toEqual([]);
    });

    it('answers another customer 404 — the same as an order that does not exist', async () => {
      const { order } = await placed();
      const stranger = await fx.user();
      as(stranger.id);

      const theirs = await upload(order.id, receiptFile());
      const missing = await upload(crypto.randomUUID(), receiptFile());

      expect(theirs.status).toBe(404);
      expect(await theirs.json()).toEqual(await missing.json());
      expect(missing.status).toBe(404);
      expect(await rows(order.id)).toHaveLength(0);
      expect(await storedFiles()).toEqual([]);
    });

    it('400s an order id that is not a uuid, before the database', async () => {
      const { user } = await placed();
      as(user.id);
      expect((await upload('not-a-uuid', receiptFile())).status).toBe(400);
    });

    it.each([
      [ORDER_STATUSES.PROCESSING, PAYMENT_METHODS.ZARINPAL],
      [ORDER_STATUSES.SHIPPED, PAYMENT_METHODS.COD],
      [ORDER_STATUSES.CANCELLED, PAYMENT_METHODS.COD],
    ] as const)(
      'refuses a receipt for a %s %s order in Persian, storing nothing',
      async (status, method) => {
        const { user, order } = await placed(status, method);
        as(user.id);

        await expectRefusal(
          upload(order.id, receiptFile()),
          409,
          'این سفارش رسید نمی‌پذیرد.',
        );
        expect(await rows(order.id)).toHaveLength(0);
        expect(await storedFiles()).toEqual([]);
      },
    );

    it('refuses the sixth receipt, pointing to support', async () => {
      const { user, order } = await placed(ORDER_STATUSES.PROCESSING);
      as(user.id);
      for (let i = 0; i < MAX_RECEIPTS_PER_ORDER; i++) {
        expect((await upload(order.id, receiptFile())).status).toBe(201);
      }

      await expectRefusal(
        upload(order.id, receiptFile()),
        409,
        RECEIPT_CAP_MESSAGE,
      );
      expect(await rows(order.id)).toHaveLength(MAX_RECEIPTS_PER_ORDER);
      expect(await storedFiles()).toHaveLength(MAX_RECEIPTS_PER_ORDER);
    });

    it('400s a request with no file', async () => {
      const { user, order } = await placed();
      as(user.id);
      await expectRefusal(upload(order.id), 400, NO_IMAGE_FILE_MESSAGE);
    });

    it('decides the type by the bytes — a PDF named and declared as a JPEG is refused', async () => {
      const { user, order } = await placed();
      as(user.id);

      await expectRefusal(
        upload(order.id, receiptFile(pdf(), 'receipt.jpg', 'image/jpeg')),
        400,
        INVALID_IMAGE_MESSAGE,
      );
      expect(await rows(order.id)).toHaveLength(0);
      expect(await storedFiles()).toEqual([]);
    });

    it('takes a receipt of exactly five megabytes', async () => {
      const { user, order } = await placed();
      as(user.id);

      const res = await upload(order.id, receiptFile(jpeg(MAX_RECEIPT_BYTES)));

      expect(res.status).toBe(201);
      const [row] = await rows(order.id);
      expect(row.size).toBe(MAX_RECEIPT_BYTES);
    });

    it('413s one byte more, storing nothing', async () => {
      const { user, order } = await placed();
      as(user.id);

      const res = await upload(
        order.id,
        receiptFile(jpeg(MAX_RECEIPT_BYTES + 1)),
      );

      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({
        status: 'error',
        message: IMAGE_TOO_LARGE_MESSAGE,
      });
      expect(await rows(order.id)).toHaveLength(0);
      expect(await storedFiles()).toEqual([]);
    });

    it('answers 503 in Persian when storage cannot keep the receipt private', async () => {
      const { user, order } = await placed();
      as(user.id);
      vi.spyOn(localDriver, 'put').mockImplementation(async (key) => {
        throw new ReceiptExposedError(key);
      });

      await expectRefusal(
        upload(order.id, receiptFile()),
        503,
        'بارگذاری رسید موقتاً ممکن نیست؛ رسید را از طریق اینستاگرام یا تلگرام بفرست.',
      );
      expect(await rows(order.id)).toHaveLength(0);
    });
  });

  describe('GET /orders/{id}/receipts/{receiptId}', () => {
    it('serves the owner the bytes — private, uncacheable, never sniffed', async () => {
      const { user, order, receiptId } = await withReceipt();
      as(user.id);

      const res = await app.request(apiOrderReceiptPath(order.id, receiptId));

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/jpeg');
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(jpeg(90));
    });

    it('serves the type its key names, whatever the row says', async () => {
      // The row's content_type is a plain text column; the key's extension
      // was minted from the sniffed bytes and is the one the public route
      // trusts too.
      const { user, order, receiptId } = await withReceipt();
      await testDb
        .update(paymentReceipts)
        .set({ contentType: 'text/html' })
        .where(eq(paymentReceipts.id, receiptId));
      as(user.id);

      const owner = await app.request(apiOrderReceiptPath(order.id, receiptId));
      as('admin-1', 'admin');
      const admin = await app.request(
        apiAdminOrderReceiptPath(order.id, receiptId),
      );

      expect(owner.headers.get('Content-Type')).toBe('image/jpeg');
      expect(admin.headers.get('Content-Type')).toBe('image/jpeg');
    });

    it('answers 401 without a session — exactly', async () => {
      const { order, receiptId } = await withReceipt();
      anon();

      const res = await app.request(apiOrderReceiptPath(order.id, receiptId));

      expect(res.status).toBe(401);
    });

    it('answers another customer 404 — the same as a receipt that does not exist', async () => {
      const { order, receiptId } = await withReceipt();
      const stranger = await fx.user();
      as(stranger.id);

      const theirs = await app.request(
        apiOrderReceiptPath(order.id, receiptId),
      );
      const missing = await app.request(
        apiOrderReceiptPath(order.id, crypto.randomUUID()),
      );

      expect(theirs.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(await theirs.json()).toEqual(await missing.json());
    });

    it('400s ids that are not uuids', async () => {
      const { user, order } = await withReceipt();
      as(user.id);
      expect(
        (await app.request(apiOrderReceiptPath(order.id, 'nope'))).status,
      ).toBe(400);
      expect(
        (await app.request(apiOrderReceiptPath('nope', crypto.randomUUID())))
          .status,
      ).toBe(400);
    });
  });

  describe('GET /admin/orders/{id}/receipts/{receiptId}', () => {
    it('serves an admin the bytes with the same headers', async () => {
      const { order, receiptId } = await withReceipt();
      as('admin-1', 'admin');

      const res = await app.request(
        apiAdminOrderReceiptPath(order.id, receiptId),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/jpeg');
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(jpeg(90));
    });

    it('answers 401 without a session and 403 to a customer — even the owner', async () => {
      const { user, order, receiptId } = await withReceipt();
      const url = apiAdminOrderReceiptPath(order.id, receiptId);

      anon();
      expect((await app.request(url)).status).toBe(401);
      as(user.id);
      expect((await app.request(url)).status).toBe(403);
    });

    it('404s a receipt asked for under another order', async () => {
      const { receiptId } = await withReceipt();
      const other = await placed();
      as('admin-1', 'admin');

      const res = await app.request(
        apiAdminOrderReceiptPath(other.order.id, receiptId),
      );

      expect(res.status).toBe(404);
    });
  });

  it('looks the session up once for an order read — one guard, not two', async () => {
    // Hono's `/orders/:id/*` also matches `/orders/:id` itself, so that one
    // mount guards the order read as well as every receipt route under it; a
    // second, exact mount would ask the database for the session twice.
    const { user, order } = await placed();
    as(user.id);

    const res = await app.request(`${API_PATHS.ORDERS}/${order.id}`);

    expect(res.status).toBe(200);
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
  });

  describe('the order projections', () => {
    it('gives the shopper each receipt as an id and a time, and the cancellation reason', async () => {
      const { user, order, receiptId } = await withReceipt();
      as(user.id);

      const res = await app.request(`${API_PATHS.ORDERS}/${order.id}`);
      const body = (await res.json()) as {
        data: {
          receipts: Record<string, unknown>[];
          cancellationReason: string | null;
        };
      };

      expect(body.data.receipts).toHaveLength(1);
      expect(body.data.receipts[0].id).toBe(receiptId);
      expect(Object.keys(body.data.receipts[0]).sort()).toEqual([
        'createdAt',
        'id',
      ]);
      expect(body.data.cancellationReason).toBeNull();
      // No storage key and no URL anywhere in what the shopper receives.
      expect(JSON.stringify(body)).not.toMatch(/receipts\//);
    });

    it('gives the admin the size and type too, but never the storage key', async () => {
      const { order, receiptId } = await withReceipt();
      as('admin-1', 'admin');

      const res = await app.request(`${API_PATHS.ADMIN_ORDERS}/${order.id}`);
      const body = (await res.json()) as {
        data: { receipts: Record<string, unknown>[] };
      };

      expect(body.data.receipts).toEqual([
        {
          id: receiptId,
          contentType: 'image/jpeg',
          size: 90,
          createdAt: expect.any(String),
        },
      ]);
      expect(JSON.stringify(body)).not.toMatch(/receipts\//);
    });
  });
});
