// adminTransitionOrder against a live Postgres — the logic that drives the CAS on
// the admin's behalf. The exhaustive legal/illegal matrix is at the endpoint
// (admin-orders.integration.test.ts); this pins the outcomes that need the real
// database: a won move, a missing order, the gateway-owned guard, and the
// lost-race conflict that maps to 409.
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { orders } from '@/db/schema/orders';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type OrderStatus,
} from '@/lib/orders/order-status';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const { adminTransitionOrder } = await importWithDb(
  () => import('@/logic/orders/admin-transition'),
);
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));

describe.skipIf(!databaseReachable)('adminTransitionOrder', () => {
  const fx = new OrderFixtures();
  afterEach(() => fx.cleanup());

  const seed = async (status: OrderStatus) => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 10 });
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 1 }], {
        status,
        paymentMethod: PAYMENT_METHODS.ZARINPAL,
      }),
    );
    fx.remember(order.id);
    return order;
  };

  const statusOf = async (id: string) => {
    const [row] = await testDb
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);
    return row.status;
  };

  it('performs a legal admin transition and reports ok', async () => {
    const order = await seed(ORDER_STATUSES.PAID);
    const result = await adminTransitionOrder(
      order.id,
      ORDER_STATUSES.PROCESSING,
    );
    expect(result.outcome).toBe('ok');
    expect(await statusOf(order.id)).toBe(ORDER_STATUSES.PROCESSING);
  });

  it('reports not_found for an id no order has', async () => {
    const result = await adminTransitionOrder(
      crypto.randomUUID(),
      ORDER_STATUSES.PROCESSING,
    );
    expect(result.outcome).toBe('not_found');
  });

  it('refuses the gateway-owned targets — an admin cannot fake paid or failed', async () => {
    const order = await seed(ORDER_STATUSES.PENDING_PAYMENT);
    // Both are legal *machine* edges from pending_payment, but the gateway owns
    // them, so the admin path rejects them without touching the row.
    for (const to of [ORDER_STATUSES.PAID, ORDER_STATUSES.FAILED]) {
      const result = await adminTransitionOrder(order.id, to);
      expect(result).toEqual({
        outcome: 'illegal',
        from: ORDER_STATUSES.PENDING_PAYMENT,
      });
    }
    expect(await statusOf(order.id)).toBe(ORDER_STATUSES.PENDING_PAYMENT);
  });

  it('reports illegal for a wrong edge from the current status', async () => {
    const order = await seed(ORDER_STATUSES.SHIPPED);
    const result = await adminTransitionOrder(
      order.id,
      ORDER_STATUSES.PROCESSING,
    );
    expect(result.outcome).toBe('illegal');
    expect(await statusOf(order.id)).toBe(ORDER_STATUSES.SHIPPED);
  });

  it('lets only one of two concurrent transitions win; the loser never applies', async () => {
    // shipped -> delivered is the one edge out of shipped, so the loser cannot
    // succeed-anyway: it is either a lost CAS (conflict) or reads the terminal
    // delivered (illegal). Never a second apply.
    const order = await seed(ORDER_STATUSES.SHIPPED);

    const [a, b] = await Promise.all([
      adminTransitionOrder(order.id, ORDER_STATUSES.DELIVERED),
      adminTransitionOrder(order.id, ORDER_STATUSES.DELIVERED),
    ]);

    const outcomes = [a.outcome, b.outcome];
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1);
    const loser = outcomes.find((o) => o !== 'ok');
    expect(['conflict', 'illegal']).toContain(loser);
    expect(await statusOf(order.id)).toBe(ORDER_STATUSES.DELIVERED);
  });
});
