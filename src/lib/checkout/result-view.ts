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
import { ORDER_STATUSES, type OrderStatus } from '@/lib/orders/order-status';

/** Which of the three result views an order status renders. */
export type ResultKind = 'success' | 'pending' | 'failed';

export type ResultView = {
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
 *  · paid / processing / shipped / delivered → success (money settled or COD
 *    confirmed; the order is live).
 *  · pending_payment → pending, with retry (the shopper never completed the
 *    gateway, or a transient verify error left it open).
 *  · failed / cancelled → failed (payment never completed and the order expired,
 *    or it was cancelled) — an explicit "منقضی/ناموفق" view, never a retry.
 */
const VIEW_BY_STATUS: Record<OrderStatus, ResultView> = {
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
