// The checkout result page is ONE page that branches on the order's
// server-authoritative status ([[Design - Checkout Flow Frontend]]). This pure
// map is that branch, split out so it can be tested exhaustively over every
// status — including the terminal ones a returning shopper can now hit, since
// the Zarinpal reconcile sweep turns an abandoned `pending_payment` order into
// `failed` + restock. Client-safe: it imports only the status vocabulary, no
// drizzle / `pg`.
//
// The status is read from GET /api/orders/:id (server-side, owner-scoped), NEVER
// from the callback's query params — the callback strips `Authority`/`Status`
// from its redirect target.
import { formatNumber } from '@/lib/format';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type OrderStatus,
  type PaymentMethod,
} from '@/lib/orders/order-status';

/** Which of the three result views an order status renders. */
type ResultKind = 'success' | 'pending' | 'failed';

type ResultView = {
  kind: ResultKind;
  /**
   * Whether to offer "retry payment" (→ POST /api/payments/zarinpal/request).
   * ONLY `pending_payment`: a paid/processing order needs no retry, and a
   * `failed`/`cancelled` order can no longer start a payment — the request
   * endpoint 422s anything that is not `pending_payment`, so a button there would
   * only produce an error.
   */
  showRetry: boolean;
};

/**
 * Maps an order status to its result view. Total over `OrderStatus` (the
 * `Record` type forces every status to be listed), so a status added later fails
 * the compile here rather than silently falling through to a wrong view.
 *
 *  · awaiting_receipt / paid / processing / shipped / delivered → success
 *    (the order is placed and live; a card-to-card one asks for its receipt).
 *  · pending_payment → pending, with retry (the shopper never completed the
 *    gateway, or a transient verify error left it open).
 *  · failed / cancelled → failed (payment never completed and the order expired,
 *    or it was cancelled) — an explicit "منقضی/ناموفق" view, never a retry.
 */
const VIEW_BY_STATUS: Record<OrderStatus, ResultView> = {
  // «سفارش ثبت شد!» holds before the receipt as after it.
  [ORDER_STATUSES.AWAITING_RECEIPT]: { kind: 'success', showRetry: false },
  [ORDER_STATUSES.PAID]: { kind: 'success', showRetry: false },
  [ORDER_STATUSES.PROCESSING]: { kind: 'success', showRetry: false },
  [ORDER_STATUSES.SHIPPED]: { kind: 'success', showRetry: false },
  [ORDER_STATUSES.DELIVERED]: { kind: 'success', showRetry: false },
  [ORDER_STATUSES.PENDING_PAYMENT]: { kind: 'pending', showRetry: true },
  [ORDER_STATUSES.FAILED]: { kind: 'failed', showRetry: false },
  [ORDER_STATUSES.CANCELLED]: { kind: 'failed', showRetry: false },
};

export const resultView = (status: OrderStatus): ResultView =>
  VIEW_BY_STATUS[status];

/** A shopper's way back to money they may have transferred for a dead order. */
const REFUND_SENTENCE =
  'اگر مبلغی واریز کرده‌ای، برای بازگشت وجه با پشتیبانی تماس بگیر.';

/**
 * What a cancelled order tells its shopper, beyond «لغو شد»: the admin's
 * reason, when there is one, and — for card to card, where the shopper may
 * well have transferred the money already — where to get it back. The one
 * sentence both the result page and the account order page show.
 */
export const cancellationNote = ({
  paymentMethod,
  cancellationReason,
}: {
  paymentMethod: PaymentMethod;
  cancellationReason: string | null;
}): string =>
  [
    cancellationReason &&
      `دلیل: ${cancellationReason}${/[.!?؟…]$/.test(cancellationReason) ? '' : '.'}`,
    paymentMethod === PAYMENT_METHODS.COD && REFUND_SENTENCE,
  ]
    .filter(Boolean)
    .join(' ');

type ResultCopy = { kind: ResultKind; title: string; sub: string };

/** What a live card-to-card order's result page says under «سفارش ثبت شد!». */
const codSub = (status: OrderStatus, receiptCount: number): string => {
  if (status === ORDER_STATUSES.AWAITING_RECEIPT) {
    return 'مبلغ سفارش را کارت به کارت کن و رسید را پایین همین صفحه بارگذاری کن تا سفارش پذیرفته شود.';
  }
  if (status === ORDER_STATUSES.PROCESSING) {
    // Accepted by hand (a receipt sent by DM), or processing from before
    // receipts existed: no receipt arrived here, and the box still takes one.
    return receiptCount > 0
      ? 'رسید دریافت شد و سفارش پذیرفته شد؛ پس از بررسی رسید، ارسال می‌شود.'
      : 'سفارش پذیرفته شد؛ رسید را می‌توانی پایین همین صفحه بارگذاری کنی.';
  }
  return 'سفارش پذیرفته شد.';
};

/**
 * The result page's heading and sub-copy for an order. Split on the method and
 * the SERVER status, never on the gateway callback's query.
 *
 * Card to card keeps «سفارش ثبت شد!» while the order is live — true before the
 * receipt as after it — and says what happens next under it. Cancelled, it says
 * so, with the admin's reason and the way back to a transfer: never the
 * gateway's «مبلغی از حساب شما کسر نشده است», which is false for a shopper who
 * transferred and was turned down.
 */
export const resultCopy = (
  order: {
    status: OrderStatus;
    paymentMethod: PaymentMethod;
    cancellationReason: string | null;
  },
  receiptCount: number,
): ResultCopy => {
  const { kind } = resultView(order.status);

  if (order.paymentMethod === PAYMENT_METHODS.COD) {
    if (kind === 'success') {
      return {
        kind,
        title: 'سفارش ثبت شد!',
        sub: codSub(order.status, receiptCount),
      };
    }
    return { kind, title: 'سفارش لغو شد', sub: cancellationNote(order) };
  }

  return {
    success: {
      kind,
      title: 'پرداخت موفق بود!',
      sub: 'پرداخت شما با موفقیت تایید شد.',
    },
    pending: {
      kind,
      title: 'در انتظار تایید پرداخت',
      sub: `پرداخت این سفارش هنوز کامل نشده است. اگر مبلغ از حسابت کم شده تا ${formatNumber(72)} ساعت تسویه می‌شود؛ در غیر این صورت می‌توانی دوباره برای پرداخت اقدام کنی.`,
    },
    failed: {
      kind,
      title: 'پرداخت ناموفق یا منقضی شد',
      sub: 'پرداخت این سفارش کامل نشد و مبلغی از حساب شما کسر نشده است. برای خرید می‌توانی دوباره اقدام کنی.',
    },
  }[kind];
};
