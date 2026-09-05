// Wiring test for buildDashboardReport against a live Postgres — proves the
// report reflects real orders: a freshly paid order lands in the current Jalali
// month's bucket and in the top-line totals. Membership/exclusion is exhaustively
// covered in OrderDao.admin.integration.test.ts; this is the assembly.
import { afterEach, describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '@/lib/orders/order-status';
import { databaseReachable, importWithDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const { buildDashboardReport } = await importWithDb(
  () => import('@/logic/orders/dashboard-report'),
);
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { PaymentDao } = await importWithDb(() => import('@/db/dao/PaymentDao'));

describe.skipIf(!databaseReachable)('buildDashboardReport', () => {
  const fx = new OrderFixtures();
  afterEach(() => fx.cleanup());

  it('reflects a freshly paid order in the current month bucket and the totals', async () => {
    const now = new Date();
    const before = await buildDashboardReport(now);

    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category);
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 1, unitPrice: 3_210_000 }], {
        status: ORDER_STATUSES.PAID,
        paymentMethod: PAYMENT_METHODS.ZARINPAL,
      }),
    );
    fx.remember(order.id);
    await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      status: PAYMENT_STATUSES.PAID,
      amount: order.total,
      authority: `A-${crypto.randomUUID()}`,
      paidAt: new Date(),
    });

    const after = await buildDashboardReport(now);

    expect(after.stats.totalRevenue - before.stats.totalRevenue).toBe(
      order.total,
    );
    expect(after.stats.paidOrderCount - before.stats.paidOrderCount).toBe(1);

    // The order was created now, so it belongs to the last (current) bucket.
    const lastBefore = before.months.at(-1)!;
    const lastAfter = after.months.at(-1)!;
    expect(lastAfter.key).toBe(lastBefore.key);
    expect(lastAfter.revenue - lastBefore.revenue).toBe(order.total);
    expect(lastAfter.orders - lastBefore.orders).toBe(1);

    // Six buckets, average is an integer.
    expect(after.months).toHaveLength(6);
    expect(Number.isInteger(after.stats.averageOrderValue)).toBe(true);
  });
});
