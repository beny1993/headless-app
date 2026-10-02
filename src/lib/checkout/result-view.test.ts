import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUS_VALUES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type OrderStatus,
} from '@/lib/orders/order-status';
import { cancellationNote, resultCopy, resultView } from './result-view';

describe('resultView', () => {
  it('maps paid and processing to the success view without a retry', () => {
    for (const status of [
      ORDER_STATUSES.PAID,
      ORDER_STATUSES.PROCESSING,
    ] as const) {
      expect(resultView(status)).toEqual({ kind: 'success', showRetry: false });
    }
  });

  it('maps a card-to-card order still waiting for its receipt to the pending view, with no retry', () => {
    // Its screenshot failed to store after the order was placed: not accepted
    // yet, so never the success view — and nothing for a gateway to retry.
    expect(resultView(ORDER_STATUSES.AWAITING_RECEIPT)).toEqual({
      kind: 'pending',
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

describe('resultCopy — card to card', () => {
  const cod = (
    status: OrderStatus,
    cancellationReason: string | null = null,
    receiptCount = 1,
  ) =>
    resultCopy(
      { status, paymentMethod: PAYMENT_METHODS.COD, cancellationReason },
      receiptCount,
    );

  it('says a waiting order is not accepted yet, and points to the box below', () => {
    // The screenshot did not arrive: the page must not read as an accepted
    // order (Benyamin, 2026-10-02) — the box sits directly under this copy.
    const copy = cod(ORDER_STATUSES.AWAITING_RECEIPT, null, 0);
    expect(copy).toEqual({
      kind: 'pending',
      title: 'سفارش هنوز پذیرفته نشده است',
      sub: 'رسید واریز به ما نرسید. اسکرین‌شات رسید را در کادر زیر بارگذاری کن تا سفارش پذیرفته شود.',
    });
    expect(copy.title).not.toBe('سفارش ثبت شد!');
  });

  it('says the receipt arrived and the order is accepted once it is processing', () => {
    expect(cod(ORDER_STATUSES.PROCESSING)).toEqual({
      kind: 'success',
      title: 'سفارش ثبت شد!',
      sub: 'رسید دریافت شد و سفارش پذیرفته شد؛ پس از بررسی رسید، ارسال می‌شود.',
    });
  });

  it('never claims a receipt arrived for an order accepted without one', () => {
    // Accepted by hand (a receipt sent by DM), or processing from before
    // receipts existed: the box below still invites one.
    expect(cod(ORDER_STATUSES.PROCESSING, null, 0).sub).toBe(
      'سفارش پذیرفته شد؛ رسید را می‌توانی پایین همین صفحه بارگذاری کنی.',
    );
  });

  it.each([ORDER_STATUSES.SHIPPED, ORDER_STATUSES.DELIVERED])(
    'promises no review still to come once the order is %s',
    (status) => {
      expect(cod(status).sub).toBe('سفارش پذیرفته شد.');
    },
  );

  it('tells a cancelled shopper why and how to get a transfer back — never that nothing was taken', () => {
    // «مبلغی از حساب شما کسر نشده است» is false for someone who transferred
    // and was turned down.
    const copy = cod(ORDER_STATUSES.CANCELLED, 'مبلغ رسید با سفارش نمی‌خواند');
    expect(copy).toEqual({
      kind: 'failed',
      title: 'سفارش لغو شد',
      sub: 'دلیل: مبلغ رسید با سفارش نمی‌خواند. اگر مبلغی واریز کرده‌ای، برای بازگشت وجه با پشتیبانی تماس بگیر.',
    });
    expect(copy.sub).not.toContain('کسر نشده');
  });

  it('still points to the refund when an older cancellation carries no reason', () => {
    expect(cod(ORDER_STATUSES.CANCELLED).sub).toBe(
      'اگر مبلغی واریز کرده‌ای، برای بازگشت وجه با پشتیبانی تماس بگیر.',
    );
  });
});

describe('resultCopy — Zarinpal, unchanged', () => {
  const zarinpal = (status: OrderStatus) =>
    resultCopy(
      {
        status,
        paymentMethod: PAYMENT_METHODS.ZARINPAL,
        cancellationReason: null,
      },
      0,
    );

  it('reads a settled payment as a success', () => {
    expect(zarinpal(ORDER_STATUSES.PAID)).toMatchObject({
      kind: 'success',
      title: 'پرداخت موفق بود!',
    });
  });

  it('keeps the gateway wording for an unsettled one', () => {
    expect(zarinpal(ORDER_STATUSES.PENDING_PAYMENT)).toMatchObject({
      kind: 'pending',
      title: 'در انتظار تایید پرداخت',
    });
  });

  it('keeps «nothing was taken» for a payment that never completed', () => {
    expect(zarinpal(ORDER_STATUSES.FAILED)).toMatchObject({
      kind: 'failed',
      title: 'پرداخت ناموفق یا منقضی شد',
    });
    expect(zarinpal(ORDER_STATUSES.FAILED).sub).toContain('کسر نشده');
  });
});

describe('cancellationNote', () => {
  it('gives the reason alone for a gateway order — no transfer to refund', () => {
    expect(
      cancellationNote({
        paymentMethod: PAYMENT_METHODS.ZARINPAL,
        cancellationReason: 'ناموجود شد',
      }),
    ).toBe('دلیل: ناموجود شد.');
  });

  it('says nothing more for a gateway order cancelled without one', () => {
    expect(
      cancellationNote({
        paymentMethod: PAYMENT_METHODS.ZARINPAL,
        cancellationReason: null,
      }),
    ).toBe('');
  });

  it('does not double a full stop the admin typed', () => {
    expect(
      cancellationNote({
        paymentMethod: PAYMENT_METHODS.ZARINPAL,
        cancellationReason: 'ناموجود شد.',
      }),
    ).toBe('دلیل: ناموجود شد.');
  });
});
