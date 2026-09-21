import { describe, expect, it } from 'vitest';
import type { OrderSummaryRow } from '@/db/dao/OrderDao';
import { ORDER_STATUSES, PAYMENT_METHODS } from '@/lib/orders/order-status';
import { toOrderSummary } from '@/lib/orders/order-summary';

// The account orders tab's row. Two things matter beyond the ISO date: the DB's
// `id` becomes `orderId`, and nothing else from the row rides along — this is a
// SUMMARY, and the route that produces it must not start leaking payment rows.
describe('toOrderSummary', () => {
  const row: OrderSummaryRow = {
    id: '44444444-4444-4444-8444-444444444444',
    orderNo: 1042,
    status: ORDER_STATUSES.PAID,
    paymentMethod: PAYMENT_METHODS.COD,
    total: 1_850_000,
    createdAt: new Date('2026-03-21T06:30:00.000Z'),
    itemCount: 3,
  };

  it('renames the row id to orderId and ISOs the date', () => {
    expect(toOrderSummary(row)).toEqual({
      orderId: '44444444-4444-4444-8444-444444444444',
      orderNo: 1042,
      status: ORDER_STATUSES.PAID,
      paymentMethod: PAYMENT_METHODS.COD,
      total: 1_850_000,
      createdAt: '2026-03-21T06:30:00.000Z',
      itemCount: 3,
    });
  });

  it('carries no `id` key the client could mistake for the order id', () => {
    expect(toOrderSummary(row) as Record<string, unknown>).not.toHaveProperty(
      'id',
    );
  });

  it('keeps an empty order at zero rather than dropping the count', () => {
    expect(toOrderSummary({ ...row, itemCount: 0 }).itemCount).toBe(0);
  });
});
