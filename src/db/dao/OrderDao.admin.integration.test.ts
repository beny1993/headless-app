// Admin/reporting reads on OrderDao — needs a live Postgres (src/db/test-db.ts).
// These prove two money-critical things a mocked db cannot:
//   · `listForAdmin` returns every order (not user-scoped), newest first, with a
//     correct line-item count and a paid-payment flag derived by subquery (never
//     an attempt-multiplying join).
//   · the revenue set is exactly «a booked, actually-paid sale» — status in
//     {paid, processing, shipped, delivered} AND an existing paid payment. COD
//     before delivery (pending) and cancelled/failed are excluded. This is the
//     definition the dashboard aggregates on, so it gets the exhaustive matrix.
//
// The reporting reads are table-wide by design, and the dev DB carries orders
// from prior QA, so their assertions are baseline-delta (measure, mutate,
// re-measure) rather than absolute — robust against whatever else is in the table.
import { afterEach, describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from '@/lib/orders/order-status';
import { databaseReachable, importWithDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { PaymentDao } = await importWithDb(() => import('@/db/dao/PaymentDao'));

const EPOCH = new Date(0);

describe.skipIf(!databaseReachable)('OrderDao admin & reporting reads', () => {
  const fx = new OrderFixtures();
  afterEach(() => fx.cleanup());

  /**
   * Creates one order with a chosen status/method and, optionally, a single
   * payment attempt in a chosen state. `unitPrice` lets a test give an order a
   * distinctive total so the summed revenue can be checked exactly.
   */
  const makeOrder = async (opts: {
    status: OrderStatus;
    method: PaymentMethod;
    payment?: PaymentStatus | null;
    unitPrice?: number;
  }) => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category);
    const order = await OrderDao.create(
      fx.buildOrder(
        user,
        [{ product, qty: 1, unitPrice: opts.unitPrice ?? product.price }],
        { status: opts.status, paymentMethod: opts.method },
      ),
    );
    fx.remember(order.id);
    if (opts.payment) {
      await PaymentDao.create({
        orderId: order.id,
        method: opts.method,
        status: opts.payment,
        amount: order.total,
        authority:
          opts.method === PAYMENT_METHODS.ZARINPAL
            ? `A-${crypto.randomUUID()}`
            : null,
        paidAt: opts.payment === PAYMENT_STATUSES.PAID ? new Date() : null,
      });
    }
    return order;
  };

  describe('listForAdmin', () => {
    it('lists orders (not user-scoped), newest first, with item counts and the paid flag', async () => {
      const paid = await makeOrder({
        status: ORDER_STATUSES.PAID,
        method: PAYMENT_METHODS.ZARINPAL,
        payment: PAYMENT_STATUSES.PAID,
      });
      const pending = await makeOrder({
        status: ORDER_STATUSES.PENDING_PAYMENT,
        method: PAYMENT_METHODS.ZARINPAL,
        payment: PAYMENT_STATUSES.PENDING,
      });

      const rows = await OrderDao.listForAdmin();
      const mine = rows.filter((r) => [paid.id, pending.id].includes(r.id));
      // Two different users' orders both show up — the list is store-wide.
      expect(mine).toHaveLength(2);

      const paidRow = mine.find((r) => r.id === paid.id)!;
      const pendingRow = mine.find((r) => r.id === pending.id)!;
      expect(paidRow.isPaid).toBe(true);
      expect(pendingRow.isPaid).toBe(false);
      expect(paidRow.itemCount).toBe(1);
      expect(paidRow.recipientName).toBe('گیرنده آزمایشی');

      // Newest first across the whole list: pending was created after paid.
      const paidIdx = rows.findIndex((r) => r.id === paid.id);
      const pendingIdx = rows.findIndex((r) => r.id === pending.id);
      expect(pendingIdx).toBeLessThan(paidIdx);
    });

    it('filters to a single status when one is given', async () => {
      const shipped = await makeOrder({
        status: ORDER_STATUSES.SHIPPED,
        method: PAYMENT_METHODS.ZARINPAL,
        payment: PAYMENT_STATUSES.PAID,
      });
      const processing = await makeOrder({
        status: ORDER_STATUSES.PROCESSING,
        method: PAYMENT_METHODS.COD,
        payment: PAYMENT_STATUSES.PENDING,
      });

      const rows = await OrderDao.listForAdmin(ORDER_STATUSES.SHIPPED);
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(shipped.id);
      expect(ids).not.toContain(processing.id);
      // Every returned row really is in the requested status.
      expect(rows.every((r) => r.status === ORDER_STATUSES.SHIPPED)).toBe(true);
    });
  });

  describe('the revenue set', () => {
    // The eight-way matrix: which (status, method, payment) tuples are revenue.
    const counted = [
      {
        name: 'zarinpal paid',
        status: ORDER_STATUSES.PAID,
        method: PAYMENT_METHODS.ZARINPAL,
        payment: PAYMENT_STATUSES.PAID,
      },
      {
        name: 'zarinpal processing (paid)',
        status: ORDER_STATUSES.PROCESSING,
        method: PAYMENT_METHODS.ZARINPAL,
        payment: PAYMENT_STATUSES.PAID,
      },
      {
        name: 'zarinpal delivered (paid)',
        status: ORDER_STATUSES.DELIVERED,
        method: PAYMENT_METHODS.ZARINPAL,
        payment: PAYMENT_STATUSES.PAID,
      },
      {
        name: 'cod delivered (paid)',
        status: ORDER_STATUSES.DELIVERED,
        method: PAYMENT_METHODS.COD,
        payment: PAYMENT_STATUSES.PAID,
      },
    ] as const;

    const excluded = [
      {
        name: 'zarinpal pending_payment (pending)',
        status: ORDER_STATUSES.PENDING_PAYMENT,
        method: PAYMENT_METHODS.ZARINPAL,
        payment: PAYMENT_STATUSES.PENDING,
      },
      {
        name: 'zarinpal failed (failed)',
        status: ORDER_STATUSES.FAILED,
        method: PAYMENT_METHODS.ZARINPAL,
        payment: PAYMENT_STATUSES.FAILED,
      },
      {
        name: 'zarinpal cancelled but paid (refund pending — not revenue)',
        status: ORDER_STATUSES.CANCELLED,
        method: PAYMENT_METHODS.ZARINPAL,
        payment: PAYMENT_STATUSES.PAID,
      },
      {
        name: 'cod processing (pending — cash not yet collected)',
        status: ORDER_STATUSES.PROCESSING,
        method: PAYMENT_METHODS.COD,
        payment: PAYMENT_STATUSES.PENDING,
      },
    ] as const;

    it('counts exactly the booked-and-paid orders, integer Toman', async () => {
      const before = await OrderDao.revenueSummary();
      const beforeRows = await OrderDao.revenueOrdersSince(EPOCH);

      let expectedRevenue = 0;
      for (const [i, c] of counted.entries()) {
        const order = await makeOrder({
          status: c.status,
          method: c.method,
          payment: c.payment,
          unitPrice: 1_000_000 + i * 111_111, // distinctive, integer
        });
        expectedRevenue += order.total;
      }
      for (const e of excluded) {
        await makeOrder({
          status: e.status,
          method: e.method,
          payment: e.payment,
        });
      }

      const after = await OrderDao.revenueSummary();
      const afterRows = await OrderDao.revenueOrdersSince(EPOCH);

      // Exactly the four counted orders were added to the revenue set…
      expect(after.orderCount - before.orderCount).toBe(counted.length);
      expect(afterRows.length - beforeRows.length).toBe(counted.length);
      // …and their totals summed as exact integers.
      expect(after.revenue - before.revenue).toBe(expectedRevenue);
      expect(Number.isInteger(after.revenue)).toBe(true);
    });

    it('honours the createdAt cutoff', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000);
      const before = await OrderDao.revenueOrdersSince(future);
      await makeOrder({
        status: ORDER_STATUSES.PAID,
        method: PAYMENT_METHODS.ZARINPAL,
        payment: PAYMENT_STATUSES.PAID,
      });
      const after = await OrderDao.revenueOrdersSince(future);
      // Created now, so it is before the future cutoff — excluded.
      expect(after.length).toBe(before.length);
    });
  });

  describe('countByStatus', () => {
    it('counts orders in one status (baseline-delta)', async () => {
      const before = await OrderDao.countByStatus(ORDER_STATUSES.PAID);
      await makeOrder({
        status: ORDER_STATUSES.PAID,
        method: PAYMENT_METHODS.ZARINPAL,
        payment: PAYMENT_STATUSES.PAID,
      });
      await makeOrder({
        status: ORDER_STATUSES.PROCESSING,
        method: PAYMENT_METHODS.COD,
        payment: PAYMENT_STATUSES.PENDING,
      });
      const after = await OrderDao.countByStatus(ORDER_STATUSES.PAID);
      expect(after - before).toBe(1);
    });
  });
});
