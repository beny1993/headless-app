// Request-level tests for GET /api/orders/:id, driven through the Hono app. Only
// the session lookup is mocked; the endpoint's authorization (auth + owner-scope)
// is pinned here, together with the projection that must never leak a payment
// row's gateway secrets. Needs a live database — see src/db/test-db.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '@/lib/orders/order-status';
import { databaseReachable, importWithDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import { apiOrderPath } from '@/lib/constant/paths';
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

  const get = (id: string) => app.request(apiOrderPath(id));

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
