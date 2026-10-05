// adminTransitionOrder against a live Postgres — the logic that drives the CAS on
// the admin's behalf. The exhaustive legal/illegal matrix is at the endpoint
// (admin-orders.integration.test.ts); this pins the outcomes that need the real
// database: a won move, a missing order, the gateway-owned guard, and the
// lost-race conflict that maps to 409.
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { orders } from '@/db/schema/orders';
import { products } from '@/db/schema/catalog';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type OrderStatus,
  type PaymentMethod,
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

  const seed = async (
    status: OrderStatus,
    paymentMethod: PaymentMethod = PAYMENT_METHODS.ZARINPAL,
  ) => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 10 });
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 1 }], { status, paymentMethod }),
    );
    fx.remember(order.id);
    return order;
  };

  const rowOf = async (id: string) => {
    const [row] = await testDb
      .select({ status: orders.status, reason: orders.cancellationReason })
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);
    return row;
  };

  const stockOf = async (orderId: string) => {
    const [item] = await OrderDao.getItems(testDb, orderId);
    const [row] = await testDb
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, item.productId));
    return row.stock;
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

  describe('a reason for every cancel', () => {
    // Every state a cancel can leave, each with the method that reaches it:
    // one rule for all of them, so a cancelled order always tells its shopper
    // why.
    it.each([
      [ORDER_STATUSES.AWAITING_RECEIPT, PAYMENT_METHODS.COD],
      [ORDER_STATUSES.PROCESSING, PAYMENT_METHODS.COD],
      [ORDER_STATUSES.PAID, PAYMENT_METHODS.ZARINPAL],
      [ORDER_STATUSES.PENDING_PAYMENT, PAYMENT_METHODS.ZARINPAL],
    ] as const)(
      'refuses to cancel a %s (%s) order without one, touching nothing',
      async (from, method) => {
        const order = await seed(from, method);
        const stock = await stockOf(order.id);

        const result = await adminTransitionOrder(
          order.id,
          ORDER_STATUSES.CANCELLED,
        );

        expect(result).toEqual({ outcome: 'reason_required' });
        expect(await rowOf(order.id)).toEqual({ status: from, reason: null });
        expect(await stockOf(order.id)).toBe(stock);
      },
    );

    it.each([ORDER_STATUSES.AWAITING_RECEIPT, ORDER_STATUSES.PROCESSING])(
      'cancels a card-to-card order from %s with its reason, stock back',
      async (from) => {
        const order = await seed(from, PAYMENT_METHODS.COD);
        const stock = await stockOf(order.id);

        const result = await adminTransitionOrder(
          order.id,
          ORDER_STATUSES.CANCELLED,
          'رسید با مبلغ سفارش نمی‌خواند',
        );

        expect(result.outcome).toBe('ok');
        expect(await rowOf(order.id)).toEqual({
          status: ORDER_STATUSES.CANCELLED,
          reason: 'رسید با مبلغ سفارش نمی‌خواند',
        });
        expect(await stockOf(order.id)).toBe(stock + 1);
      },
    );

    it('accepts a waiting order by hand with no reason at all', async () => {
      // A receipt that came by DM: the admin moves it on, nothing to explain.
      const order = await seed(
        ORDER_STATUSES.AWAITING_RECEIPT,
        PAYMENT_METHODS.COD,
      );

      const result = await adminTransitionOrder(
        order.id,
        ORDER_STATUSES.PROCESSING,
      );

      expect(result.outcome).toBe('ok');
      expect(await rowOf(order.id)).toEqual({
        status: ORDER_STATUSES.PROCESSING,
        reason: null,
      });
    });

    it('keeps an unknown order not_found even without a reason', async () => {
      // Existence is checked before the reason: a missing order is a 404, not
      // a request to fill in a field.
      const result = await adminTransitionOrder(
        crypto.randomUUID(),
        ORDER_STATUSES.CANCELLED,
      );
      expect(result.outcome).toBe('not_found');
    });
  });
});
