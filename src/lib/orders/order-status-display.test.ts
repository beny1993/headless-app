// Pure display map — no database. Asserts exhaustiveness (every status has a
// non-empty Persian label and a badge class) so a status added later cannot ship
// a blank badge, and pins the labels the account UI shows.
import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUS_VALUES,
  ORDER_STATUSES,
  PAYMENT_STATUS_VALUES,
  PAYMENT_STATUSES,
} from '@/lib/orders/order-status';
import {
  orderStatusBadge,
  paymentStatusBadge,
} from '@/lib/orders/order-status-display';

describe('orderStatusBadge', () => {
  it('has a non-empty label and badge for every order status', () => {
    for (const status of ORDER_STATUS_VALUES) {
      const { label, badge } = orderStatusBadge(status);
      expect(label.length).toBeGreaterThan(0);
      expect(badge.length).toBeGreaterThan(0);
    }
  });

  it('labels the pinned statuses', () => {
    expect(orderStatusBadge(ORDER_STATUSES.PENDING_PAYMENT).label).toBe(
      'در انتظار پرداخت',
    );
    expect(orderStatusBadge(ORDER_STATUSES.DELIVERED).label).toBe('تحویل شده');
    expect(orderStatusBadge(ORDER_STATUSES.CANCELLED).label).toBe('لغو شده');
    expect(orderStatusBadge(ORDER_STATUSES.AWAITING_RECEIPT).label).toBe(
      'در انتظار رسید واریز',
    );
  });

  it('never lets the receipt-waiting label and a payment-waiting one match each other', () => {
    // A locator finds text by substring. The Zarinpal badge «در انتظار پرداخت»
    // and heading «در انتظار تایید پرداخت» must not match the card-to-card
    // waiting badge, nor it them — «more than a hamza apart», as the story says.
    const waiting = orderStatusBadge(ORDER_STATUSES.AWAITING_RECEIPT).label;
    for (const other of [
      orderStatusBadge(ORDER_STATUSES.PENDING_PAYMENT).label,
      'در انتظار تایید پرداخت',
    ]) {
      expect(waiting).not.toContain(other);
      expect(other).not.toContain(waiting);
    }
  });

  it('gives every status a label of its own', () => {
    const labels = ORDER_STATUS_VALUES.map((s) => orderStatusBadge(s).label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('paymentStatusBadge', () => {
  it('has a non-empty label and badge for every payment status', () => {
    for (const status of PAYMENT_STATUS_VALUES) {
      const { label, badge } = paymentStatusBadge(status);
      expect(label.length).toBeGreaterThan(0);
      expect(badge.length).toBeGreaterThan(0);
    }
  });

  it('labels paid', () => {
    expect(paymentStatusBadge(PAYMENT_STATUSES.PAID).label).toBe('پرداخت شده');
  });
});
