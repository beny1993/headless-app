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
import { RECEIPT_WAIT_MINUTES } from '@/lib/orders/receipt';

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
 *  · paid / processing / shipped / delivered → success (the order is placed
 *    and live).
 *  · pending_payment → pending, with retry (the shopper never completed the
 *    gateway, or a transient verify error left it open).
 *  · awaiting_receipt → pending, without one: a card-to-card order whose
 *    screenshot failed to store after it was placed. Not accepted yet, so it
 *    never reads as a success, and there is no gateway to retry.
 *  · failed / cancelled → failed (payment never completed and the order expired,
 *    or it was cancelled) — an explicit "منقضی/ناموفق" view, never a retry.
 */
const VIEW_BY_STATUS: Record<OrderStatus, ResultView> = {
  [ORDER_STATUSES.AWAITING_RECEIPT]: { kind: 'pending', showRetry: false },
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

/**
 * A shopper's way back to money they may have transferred for a dead order —
 * a cancelled one here, a card-to-card checkout the server refused in the form.
 */
export const REFUND_SENTENCE =
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

/** What an accepted card-to-card order's result page says under «سفارش ثبت شد!». */
const codSub = (status: OrderStatus, receiptCount: number): string => {
  if (status === ORDER_STATUSES.PROCESSING) {
    // Accepted by hand (a receipt sent by DM), or processing from before
    // receipts existed: no receipt arrived here.
    if (receiptCount > 0) {
      return 'رسید دریافت شد و سفارش پذیرفته شد؛ پس از بررسی رسید، ارسال می‌شود.';
    }
  }
  return 'سفارش پذیرفته شد.';
};

/**
 * The result page's heading and sub-copy for an order — and the account order
 * page's banner for a card-to-card order still waiting. Split on the method and
 * the SERVER status, never on the gateway callback's query.
 *
 * Card to card reads «سفارش ثبت شد!» once the order is accepted, and says what
 * happens next under it. Still waiting for its receipt, it says the order is
 * not accepted yet and how long its screenshot has; the pages lead back to the
 * checkout's retry (`checkoutResumePath`), the one place a receipt is sent. Cancelled, it says
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
    if (kind === 'pending') {
      return {
        kind,
        title: 'سفارش هنوز پذیرفته نشده است',
        sub: `رسید واریز به ما نرسید. تا ${formatNumber(RECEIPT_WAIT_MINUTES)} دقیقه پس از ثبت، تصویر رسید را بفرست؛ وگرنه سفارش لغو می‌شود.`,
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
