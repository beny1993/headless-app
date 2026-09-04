// Request-level tests for GET /api/me/orders, driven through the Hono app. Only
// the session lookup is mocked; the list is owner-scoped (a customer sees only
// their own orders) and carries NO payment rows, so no gateway secret can leak.
// Needs a live database — see src/db/test-db.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAYMENT_METHODS, PAYMENT_STATUSES } from '@/lib/orders/order-status';
import { databaseReachable, importWithDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import { API_PATHS } from '@/lib/constant/paths';
import type { ApiResponse } from '@/lib/hono/envelope';
import type { OrderSummaryResponse } from '@/lib/hono/routes/me-orders';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ isAuthenticatedUser: mocks.getSession }));

const { app } = await importWithDb(() => import('@/lib/hono'));
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { PaymentDao } = await importWithDb(() => import('@/db/dao/PaymentDao'));

describe.skipIf(!databaseReachable)('GET /api/me/orders', () => {
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

  const list = () => app.request(API_PATHS.ME_ORDERS);

  it('401s without a session', async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await list()).status).toBe(401);
  });

  it('returns only the caller’s orders, newest first, with item counts', async () => {
    const owner = await fx.user();
    const other = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 20 });

    const first = await OrderDao.create(
      fx.buildOrder(owner, [{ product, qty: 2 }]),
    );
    fx.remember(first.id);
    const second = await OrderDao.create(
      fx.buildOrder(owner, [{ product, qty: 1 }]),
    );
    fx.remember(second.id);
    const foreign = await OrderDao.create(fx.buildOrder(other, [{ product }]));
    fx.remember(foreign.id);

    asUser(owner.id);
    const res = await list();
    const payload = (await res.json()) as ApiResponse<OrderSummaryResponse[]>;
    if (payload.status !== 'success') throw new Error(payload.message);

    expect(payload.data).toHaveLength(2);
    expect(payload.data[0].orderId).toBe(second.id); // newest first
    expect(payload.data.map((o) => o.orderId)).not.toContain(foreign.id);
    expect(payload.data[0].itemCount).toBe(1);
  });

  it('returns an empty list for a user with no orders', async () => {
    const user = await fx.user();
    asUser(user.id);
    const payload = (await (await list()).json()) as ApiResponse<
      OrderSummaryResponse[]
    >;
    if (payload.status !== 'success') throw new Error(payload.message);
    expect(payload.data).toEqual([]);
  });

  it('never carries a payment row’s gateway secrets in the list', async () => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 5 });
    const order = await OrderDao.create(fx.buildOrder(user, [{ product }]));
    fx.remember(order.id);
    await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      status: PAYMENT_STATUSES.PAID,
      amount: order.total,
      authority: 'A00000000000000000000000000000000009',
      cardPan: '6274-****-****-9999',
      gatewayResponse: { code: 100 },
      paidAt: new Date(),
    });

    asUser(user.id);
    const raw = await (await list()).text();
    expect(raw).not.toContain('authority');
    expect(raw).not.toContain('cardPan');
    expect(raw).not.toContain('gatewayResponse');
    expect(raw).not.toContain('6274-****-****-9999');
  });
});
