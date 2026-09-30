import { describe, expect, it } from 'vitest';
import { ORDER_STATUS_VALUES, ORDER_STATUSES } from '@/lib/orders/order-status';
import { resultView } from './result-view';

describe('resultView', () => {
  it('maps paid and processing to the success view without a retry', () => {
    for (const status of [
      ORDER_STATUSES.PAID,
      ORDER_STATUSES.PROCESSING,
    ] as const) {
      expect(resultView(status)).toEqual({ kind: 'success', showRetry: false });
    }
  });

  it('maps a card-to-card order waiting for its receipt to the success view', () => {
    // «سفارش ثبت شد!» is true before the upload as after it; the page asks for
    // the transfer and the receipt, never for a gateway retry.
    expect(resultView(ORDER_STATUSES.AWAITING_RECEIPT)).toEqual({
      kind: 'success',
      showRetry: false,
    });
  });

  it('maps shipped and delivered to the success view (a live/completed order)', () => {
    for (const status of [
      ORDER_STATUSES.SHIPPED,
      ORDER_STATUSES.DELIVERED,
    ] as const) {
      expect(resultView(status)).toEqual({ kind: 'success', showRetry: false });
    }
  });

  it('maps pending_payment to the pending view WITH a retry button', () => {
    expect(resultView(ORDER_STATUSES.PENDING_PAYMENT)).toEqual({
      kind: 'pending',
      showRetry: true,
    });
  });

  it('maps failed and cancelled to the failed view without a retry', () => {
    for (const status of [
      ORDER_STATUSES.FAILED,
      ORDER_STATUSES.CANCELLED,
    ] as const) {
      expect(resultView(status)).toEqual({ kind: 'failed', showRetry: false });
    }
  });

  it('covers every order status (no status falls through)', () => {
    for (const status of ORDER_STATUS_VALUES) {
      const view = resultView(status);
      expect(['success', 'pending', 'failed']).toContain(view.kind);
      // Retry is offered on exactly one status.
      expect(view.showRetry).toBe(status === ORDER_STATUSES.PENDING_PAYMENT);
    }
  });
});
