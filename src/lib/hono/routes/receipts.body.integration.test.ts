// @vitest-environment node
// What a refused receipt upload costs the server: nothing of its body. A
// chunked request (no Content-Length) is the case that matters — Hono's
// `bodyLimit` reads such a body in full before letting the request on — so the
// ownership and state gate has to run BEFORE the body limit, and the body limit
// before the handler that parses the body.
//
// Measured on a stream that counts what it hands out and holds nothing back
// (a zero high-water mark), through the real Hono app with only the session
// lookup mocked. Node's environment, not happy-dom's: a streamed request body
// needs Node's own Request.
//
// Needs a live database — see src/db/test-db.ts.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { paymentReceipts } from '@/db/schema/orders';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import { apiOrderReceiptsPath } from '@/lib/constant/paths';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type OrderStatus,
} from '@/lib/orders/order-status';
import {
  MAX_RECEIPT_BYTES,
  MAX_RECEIPTS_PER_ORDER,
} from '@/lib/orders/receipt';
import { IMAGE_FIELD_NAME } from '@/lib/storage/image-upload';
import { VARS } from '@/lib/utils/env';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ isAuthenticatedUser: mocks.getSession }));
vi.mock('@/logic/orders/notify-new-order', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/logic/orders/notify-new-order')>()),
  notifyAdminsOfNewOrder: vi.fn(),
}));

const { app } = await importWithDb(() => import('@/lib/hono'));
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));

const MiB = 1024 * 1024;

let root: string;
const originalRoot = process.env[VARS.APP_CONFIG_STORAGE_LOCAL_ROOT];
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'smokey-receipt-body-'));
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

const as = (id: string) =>
  mocks.getSession.mockResolvedValue({
    user: { id, role: 'customer' },
    session: { id: `s-${id}` },
  });

type Framing = 'length' | 'chunked';

/**
 * Posts a receipt of `size` bytes and reports how much of the encoded body the
 * server pulled: `read` and `total`, in bytes. Chunked framing sends no
 * Content-Length, so nothing can be decided from the headers alone.
 */
const post = async (orderId: string, size: number, framing: Framing) => {
  const file = new Uint8Array(new ArrayBuffer(size));
  file.set([0xff, 0xd8, 0xff, 0xe0]);
  const form = new FormData();
  form.set(IMAGE_FIELD_NAME, new File([file], 'r.jpg', { type: 'image/jpeg' }));
  const encoded = new Response(form);
  const all = new Uint8Array(await encoded.arrayBuffer());

  let read = 0;
  const CHUNK = 64 * 1024;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (read >= all.byteLength) return controller.close();
        controller.enqueue(all.subarray(read, read + CHUNK));
        read = Math.min(read + CHUNK, all.byteLength);
      },
    },
    new CountQueuingStrategy({ highWaterMark: 0 }),
  );
  const headers: Record<string, string> = {
    'content-type': encoded.headers.get('content-type') ?? '',
  };
  if (framing === 'length') headers['content-length'] = String(all.byteLength);
  else headers['transfer-encoding'] = 'chunked';

  const res = await app.request(apiOrderReceiptsPath(orderId), {
    method: 'POST',
    body,
    headers,
    duplex: 'half',
  } as RequestInit);
  return { status: res.status, read, total: all.byteLength };
};

describe.skipIf(!databaseReachable)('receipt upload bodies', () => {
  const fx = new OrderFixtures();

  afterEach(async () => {
    mocks.getSession.mockReset();
    await fx.cleanup();
    await rm(path.join(root, 'receipts'), { recursive: true, force: true });
  });

  const placed = async (
    status: OrderStatus = ORDER_STATUSES.AWAITING_RECEIPT,
  ) => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 10 });
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 1 }], {
        status,
        paymentMethod: PAYMENT_METHODS.COD,
      }),
    );
    fx.remember(order.id);
    return { user, order };
  };

  /** An order already holding the most receipts it may. */
  const atCap = async () => {
    const placedOrder = await placed(ORDER_STATUSES.PROCESSING);
    await testDb.insert(paymentReceipts).values(
      Array.from({ length: MAX_RECEIPTS_PER_ORDER }, () => ({
        orderId: placedOrder.order.id,
        objectKey: `receipts/${crypto.randomUUID()}.jpg`,
        contentType: 'image/jpeg',
        size: 10,
      })),
    );
    return placedOrder;
  };

  describe.each(['length', 'chunked'] as const)('framed by %s', (framing) => {
    it('reads nothing of an upload to another customer’s order', async () => {
      const { order } = await placed();
      as((await fx.user()).id);

      const res = await post(order.id, 3 * MiB, framing);

      expect(res.status).toBe(404);
      expect(res.read).toBe(0);
    });

    it('reads nothing of an upload to an order at its cap', async () => {
      const { user, order } = await atCap();
      as(user.id);

      const res = await post(order.id, 3 * MiB, framing);

      expect(res.status).toBe(409);
      expect(res.read).toBe(0);
    });

    it('reads nothing of an upload to a shipped order', async () => {
      const { user, order } = await placed(ORDER_STATUSES.SHIPPED);
      as(user.id);

      const res = await post(order.id, 3 * MiB, framing);

      expect(res.status).toBe(409);
      expect(res.read).toBe(0);
    });

    it('takes the owner’s receipt', async () => {
      const { user, order } = await placed();
      as(user.id);

      const res = await post(order.id, MiB, framing);

      expect(res.status).toBe(201);
    });
  });

  it('refuses the owner’s oversize body from its length alone, reading none of it', async () => {
    // Nothing read means the handler never ran: its multipart parse reads the
    // whole body before any size check of its own can answer.
    const { user, order } = await placed();
    as(user.id);

    const res = await post(order.id, MAX_RECEIPT_BYTES + MiB, 'length');

    expect(res.status).toBe(413);
    expect(res.read).toBe(0);
  });

  it('stops reading the owner’s oversize chunked body at the limit', async () => {
    const { user, order } = await placed();
    as(user.id);

    const res = await post(order.id, MAX_RECEIPT_BYTES + MiB, 'chunked');

    expect(res.status).toBe(413);
    expect(res.read).toBeLessThan(res.total);
  });
});
