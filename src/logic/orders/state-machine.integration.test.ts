// Needs a live database — see src/db/test-db.ts. The pure transition rules are
// checked without one in src/lib/orders/order-status.test.ts; this suite proves
// the DB side effects and the concurrency guarantees the design rests on.
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { orders } from '@/db/schema/orders';
import { products as productsTable } from '@/db/schema/catalog';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '@/lib/orders/order-status';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const { transitionOrder, InvalidTransitionError } = await importWithDb(
  () => import('@/logic/orders/state-machine'),
);
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { PaymentDao } = await importWithDb(() => import('@/db/dao/PaymentDao'));
const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));

describe.skipIf(!databaseReachable)('transitionOrder', () => {
  const fx = new OrderFixtures();
  afterEach(() => fx.cleanup());

  /** Runs one transition in its own transaction, as a real caller would. */
  const move = (id: string, from: string, to: string) =>
    testDb.transaction((tx) =>
      transitionOrder(tx, id, from as never, to as never),
    );

  const statusOf = async (id: string) => {
    const [row] = await testDb
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);
    return row.status;
  };

  const stockOf = async (id: string) => {
    const [row] = await testDb
      .select({ stock: productsTable.stock })
      .from(productsTable)
      .where(eq(productsTable.id, id))
      .limit(1);
    return row.stock;
  };

  /** Creates a Zarinpal order in pending_payment, its stock already reserved. */
  const pendingOrder = async (qty = 2, initialStock = 10) => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: initialStock });
    // Simulate checkout reserving stock with the oversell guard.
    await ProductDao.decrementStock(testDb, product.id, qty);
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty }]),
    );
    fx.remember(order.id);
    return { order, product, qty };
  };

  it('performs a legal transition', async () => {
    const { order } = await pendingOrder();

    const result = await move(
      order.id,
      ORDER_STATUSES.PENDING_PAYMENT,
      ORDER_STATUSES.PAID,
    );

    expect(result.status).toBe(ORDER_STATUSES.PAID);
    expect(await statusOf(order.id)).toBe(ORDER_STATUSES.PAID);
  });

  it('rejects an illegal edge before touching the row', async () => {
    const { order } = await pendingOrder();

    await expect(
      move(order.id, ORDER_STATUSES.PENDING_PAYMENT, ORDER_STATUSES.SHIPPED),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
    // Untouched — the pair was rejected by the map, no CAS ran.
    expect(await statusOf(order.id)).toBe(ORDER_STATUSES.PENDING_PAYMENT);
  });

  it('rejects a legal edge whose `from` does not match the row (stale caller)', async () => {
    const { order } = await pendingOrder();

    // paid -> processing is legal, but the order is still pending_payment, so
    // the CAS matches nothing.
    await expect(
      move(order.id, ORDER_STATUSES.PAID, ORDER_STATUSES.PROCESSING),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(await statusOf(order.id)).toBe(ORDER_STATUSES.PENDING_PAYMENT);
  });

  it('restocks every line item when cancelled, by exactly the ordered qty', async () => {
    const { order, product } = await pendingOrder(3, 10);
    expect(await stockOf(product.id)).toBe(7); // reserved

    await move(
      order.id,
      ORDER_STATUSES.PENDING_PAYMENT,
      ORDER_STATUSES.CANCELLED,
    );

    expect(await stockOf(product.id)).toBe(10); // returned
  });

  it('restocks when failed', async () => {
    const { order, product } = await pendingOrder(4, 10);
    expect(await stockOf(product.id)).toBe(6);

    await move(order.id, ORDER_STATUSES.PENDING_PAYMENT, ORDER_STATUSES.FAILED);

    expect(await stockOf(product.id)).toBe(10);
  });

  it('does not restock on a non-cancel transition', async () => {
    const { order, product } = await pendingOrder(2, 10);
    expect(await stockOf(product.id)).toBe(8);

    await move(order.id, ORDER_STATUSES.PENDING_PAYMENT, ORDER_STATUSES.PAID);

    expect(await stockOf(product.id)).toBe(8); // unchanged
  });

  it('does not restock twice — a second cancel cannot fire', async () => {
    const { order, product } = await pendingOrder(3, 10);

    await move(
      order.id,
      ORDER_STATUSES.PENDING_PAYMENT,
      ORDER_STATUSES.CANCELLED,
    );
    expect(await stockOf(product.id)).toBe(10);

    // Re-issuing the same cancel finds the row already cancelled: no row, no
    // second restock.
    await expect(
      move(order.id, ORDER_STATUSES.PENDING_PAYMENT, ORDER_STATUSES.CANCELLED),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(await stockOf(product.id)).toBe(10);
  });

  it('flips the pending COD payment to paid on delivery', async () => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 10 });
    await ProductDao.decrementStock(testDb, product.id, 1);
    // COD orders enter at processing, with a pending COD payment row.
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 1 }], {
        status: ORDER_STATUSES.PROCESSING,
        paymentMethod: PAYMENT_METHODS.COD,
      }),
    );
    fx.remember(order.id);
    await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.COD,
      amount: order.total,
    });

    await move(order.id, ORDER_STATUSES.PROCESSING, ORDER_STATUSES.SHIPPED);
    await move(order.id, ORDER_STATUSES.SHIPPED, ORDER_STATUSES.DELIVERED);

    const [payment] = await PaymentDao.listByOrder(order.id);
    expect(payment.status).toBe(PAYMENT_STATUSES.PAID);
    expect(payment.paidAt).toBeInstanceOf(Date);
    expect(await statusOf(order.id)).toBe(ORDER_STATUSES.DELIVERED);
  });

  it('rolls the whole delivery back when the COD payment row is missing', async () => {
    // A COD order reaching delivered with no pending COD payment is corruption;
    // markCodPaid throws, and the status change must roll back with it.
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 10 });
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 1 }], {
        status: ORDER_STATUSES.SHIPPED,
        paymentMethod: PAYMENT_METHODS.COD,
      }),
    );
    fx.remember(order.id);
    // No payment row created.

    await expect(
      move(order.id, ORDER_STATUSES.SHIPPED, ORDER_STATUSES.DELIVERED),
    ).rejects.toThrow();
    expect(await statusOf(order.id)).toBe(ORDER_STATUSES.SHIPPED); // rolled back
  });

  it('lets exactly one of two concurrent transitions win (CAS race)', async () => {
    const { order, product } = await pendingOrder(3, 10);
    expect(await stockOf(product.id)).toBe(7);

    const [toPaid, toCancelled] = await Promise.allSettled([
      move(order.id, ORDER_STATUSES.PENDING_PAYMENT, ORDER_STATUSES.PAID),
      move(order.id, ORDER_STATUSES.PENDING_PAYMENT, ORDER_STATUSES.CANCELLED),
    ]);

    const outcomes = [toPaid.status, toCancelled.status].sort();
    expect(outcomes).toEqual(['fulfilled', 'rejected']);

    const finalStatus = await statusOf(order.id);
    if (toCancelled.status === 'fulfilled') {
      expect(finalStatus).toBe(ORDER_STATUSES.CANCELLED);
      expect(await stockOf(product.id)).toBe(10); // cancel won -> restocked
    } else {
      expect(finalStatus).toBe(ORDER_STATUSES.PAID);
      expect(await stockOf(product.id)).toBe(7); // paid won -> not restocked
      expect((toCancelled as PromiseRejectedResult).reason).toBeInstanceOf(
        InvalidTransitionError,
      );
    }
  });

  it('marks an order paid at most once under concurrent verifies', async () => {
    // Two Zarinpal verify attempts racing pending_payment -> paid: only one may
    // win, which is what keeps a double verify from double-charging.
    const { order } = await pendingOrder(1, 10);

    const results = await Promise.allSettled([
      move(order.id, ORDER_STATUSES.PENDING_PAYMENT, ORDER_STATUSES.PAID),
      move(order.id, ORDER_STATUSES.PENDING_PAYMENT, ORDER_STATUSES.PAID),
    ]);

    const won = results.filter((r) => r.status === 'fulfilled');
    expect(won).toHaveLength(1);
    expect(await statusOf(order.id)).toBe(ORDER_STATUSES.PAID);
  });
});
