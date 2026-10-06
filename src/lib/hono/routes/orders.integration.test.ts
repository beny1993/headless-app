// Request-level tests for GET /api/orders/:id, driven through the Hono app. Only
// the session lookup is mocked; the endpoint's authorization (auth + owner-scope)
// is pinned here, together with the projection that must never leak a payment
// row's gateway secrets. Needs a live database — see src/db/test-db.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type OrderStatus,
} from '@/lib/orders/order-status';
import { databaseReachable, importWithDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import { API_PATHS, apiOrderCancelPath } from '@/lib/constant/paths';
import type { ApiResponse } from '@/lib/hono/envelope';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ isAuthenticatedUser: mocks.getSession }));

const { app } = await importWithDb(() => import('@/lib/hono'));
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { PaymentDao } = await importWithDb(() => import('@/db/dao/PaymentDao'));

describe.skipIf(!databaseReachable)('GET /api/orders/:id', () => {
  const fx = new OrderFixtures();
  afterEach(() => {
    mocks.getSession.mockReset();
    return fx.cleanup();
  });

  const asUser = (id: string) =>
    mocks.getSession.mockResolvedValue({
      user: { id, email: 'c@example.com', role: 'customer' },
      session: { id: 's1' },
    });

  const seedOrder = async () => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 5 });
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 2 }], {
        status: ORDER_STATUSES.PROCESSING,
        paymentMethod: PAYMENT_METHODS.COD,
      }),
    );
    fx.remember(order.id);
    return { user, order, product };
  };

  const get = (id: string) => app.request(`${API_PATHS.ORDERS}/${id}`);

  it('rejects an unauthenticated request with 401', async () => {
    const { order } = await seedOrder();
    mocks.getSession.mockResolvedValue(null);

    expect((await get(order.id)).status).toBe(401);
  });

  it('returns the owner’s order with item snapshots', async () => {
    const { user, order, product } = await seedOrder();
    asUser(user.id);

    const response = await get(order.id);
    const payload = (await response.json()) as ApiResponse<{
      orderId: string;
      orderNo: number;
      items: { sku: string; qty: number }[];
    }>;

    expect(response.status).toBe(200);
    if (payload.status !== 'success') throw new Error(payload.message);
    expect(payload.data.orderId).toBe(order.id);
    expect(payload.data.orderNo).toBe(order.orderNo);
    expect(payload.data.items[0].sku).toBe(product.sku);
  });

  it('answers another user’s order with 404, not 403 (no existence leak)', async () => {
    const { order } = await seedOrder();
    const attacker = await fx.user();
    asUser(attacker.id);

    expect((await get(order.id)).status).toBe(404);
  });

  it('answers a well-formed but unknown id with 404', async () => {
    const user = await fx.user();
    asUser(user.id);

    expect((await get(crypto.randomUUID())).status).toBe(404);
  });

  it('400s a non-uuid id (a 22P02 would otherwise be a 500)', async () => {
    const user = await fx.user();
    asUser(user.id);

    expect((await get('not-a-uuid')).status).toBe(400);
  });

  it('401s an unauthenticated non-uuid id — auth runs before param parsing', async () => {
    mocks.getSession.mockResolvedValue(null);

    // Not 400: requireAuth is mounted ahead of the route, so a stranger never
    // reaches validation. Pins the guard-before-parse ordering.
    expect((await get('not-a-uuid')).status).toBe(401);
  });

  it('never leaks a payment row’s gateway secrets', async () => {
    const { user, order } = await seedOrder();
    asUser(user.id);
    await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      status: PAYMENT_STATUSES.PAID,
      amount: order.total,
      authority: 'A00000000000000000000000000000000001',
      refId: '987654321',
      cardPan: '6274-****-****-1234',
      gatewayResponse: { code: 100 },
      failureReason: 'none',
      paidAt: new Date(),
    });

    const raw = await (await get(order.id)).text();

    expect(raw).not.toContain('authority');
    expect(raw).not.toContain('cardPan');
    expect(raw).not.toContain('gatewayResponse');
    expect(raw).not.toContain('6274-****-****-1234');
  });
});

describe.skipIf(!databaseReachable)('POST /api/orders/:id/cancel', () => {
  const fx = new OrderFixtures();
  afterEach(() => {
    mocks.getSession.mockReset();
    return fx.cleanup();
  });

  const asUser = (id: string) =>
    mocks.getSession.mockResolvedValue({
      user: { id, email: 'c@example.com', role: 'customer' },
      session: { id: 's1' },
    });

  const seedOrder = async (status: OrderStatus) => {
    const user = await fx.user();
    const product = await fx.product(await fx.category(), { stock: 5 });
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 1 }], {
        status,
        paymentMethod: PAYMENT_METHODS.COD,
      }),
    );
    fx.remember(order.id);
    return { user, order };
  };

  const cancel = (id: string) =>
    app.request(apiOrderCancelPath(id), { method: 'POST' });
  const statusOf = async (id: string) => (await OrderDao.getById(id))?.status;

  it('rejects an unauthenticated request with 401', async () => {
    const { order } = await seedOrder(ORDER_STATUSES.AWAITING_RECEIPT);
    mocks.getSession.mockResolvedValue(null);

    expect((await cancel(order.id)).status).toBe(401);
    expect(await statusOf(order.id)).toBe(ORDER_STATUSES.AWAITING_RECEIPT);
  });

  it('cancels the owner’s waiting order', async () => {
    const { user, order } = await seedOrder(ORDER_STATUSES.AWAITING_RECEIPT);
    asUser(user.id);

    const response = await cancel(order.id);

    expect(response.status).toBe(200);
    expect(await statusOf(order.id)).toBe(ORDER_STATUSES.CANCELLED);
  });

  it('answers another user’s order with 404 and leaves it be (IDOR)', async () => {
    const { order } = await seedOrder(ORDER_STATUSES.AWAITING_RECEIPT);
    asUser((await fx.user()).id);

    expect((await cancel(order.id)).status).toBe(404);
    expect(await statusOf(order.id)).toBe(ORDER_STATUSES.AWAITING_RECEIPT);
  });

  it('refuses an accepted order with 409 in Persian', async () => {
    const { user, order } = await seedOrder(ORDER_STATUSES.PROCESSING);
    asUser(user.id);

    const response = await cancel(order.id);
    const payload = (await response.json()) as ApiResponse<unknown>;

    expect(response.status).toBe(409);
    expect(payload.status === 'error' && payload.message).toBe(
      'این سفارش دیگر قابل لغو نیست.',
    );
    expect(await statusOf(order.id)).toBe(ORDER_STATUSES.PROCESSING);
  });

  it('rejects a non-uuid id with 400', async () => {
    asUser((await fx.user()).id);
    expect((await cancel('not-a-uuid')).status).toBe(400);
  });
});
