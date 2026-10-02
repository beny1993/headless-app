import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, Clock, XCircle } from 'lucide-react';
import { CardToCardPanel } from '@/features/checkout/card-to-card';
import {
  loadOwnedOrder,
  readCardToCardPayment,
} from '@/features/checkout/load-owned-order';
import {
  OrderSummary,
  toSummaryLines,
} from '@/features/checkout/order-summary';
import { ReceiptBox } from '@/features/checkout/receipt-box';
import { RetryPaymentButton } from '@/features/checkout/retry-payment-button';
import { SupportLine } from '@/features/checkout/support-line';
import { resultCopy, resultView } from '@/lib/checkout/result-view';
import { PATHS, checkoutResultPath, shopPath } from '@/lib/constant/paths';
import {
  formatJalali,
  formatJalaliDateTime,
  toPersianDigits,
} from '@/lib/format';
import {
  ORDER_STATUSES,
  PAYMENT_METHOD_LABELS,
} from '@/lib/orders/order-status';
import { orderStatusBadge } from '@/lib/orders/order-status-display';
import { acceptsReceipts, showsReceipts } from '@/lib/orders/receipt';

export const metadata: Metadata = { title: 'نتیجه سفارش' };

/**
 * The one checkout result page, for a card-to-card order (its transfer details
 * and receipt box while it takes receipts) and every Zarinpal outcome.
 * It branches on the order's SERVER status (`getOwnedOrder`, owner-scoped by the
 * session id), never on the callback's query — which strips `Authority`/`Status`
 * anyway. A server component so `requireSession` is the re-login path: the
 * gateway callback is unauthenticated, so a session that expired during the round
 * trip lands here, is bounced through OTP with `?next=` back to this exact URL
 * (via `safeNextPath`), and returns to see the settled order.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const order = await loadOwnedOrder(
    (await params).orderId,
    checkoutResultPath,
  );

  const view = resultView(order.status);
  const { title, sub } = resultCopy(order, order.receipts.length);
  const status = orderStatusBadge(order.status);
  // Where to send the money, for as long as the order takes a receipt — a
  // second transfer under a daily card limit needs the numbers too. Accepted
  // into shipping, or cancelled, it has nothing left to pay here.
  const cardToCard = acceptsReceipts(order)
    ? await readCardToCardPayment()
    : null;
  const panel = cardToCard && (
    <CardToCardPanel key="card-to-card" payment={cardToCard} className="mb-7" />
  );
  const box = showsReceipts(order, order.receipts.length) && (
    <ReceiptBox
      key="receipts"
      orderId={order.id}
      orderStatus={order.status}
      receipts={order.receipts.map((receipt) => ({
        id: receipt.id,
        uploadedAt: formatJalaliDateTime(receipt.createdAt),
      }))}
      eventPrefix="checkout-result"
    />
  );
  const details = (
    <div
      key="details"
      className="border-border mb-7 overflow-hidden rounded-2xl border text-start"
    >
      <div className="bg-secondary/50 flex items-center justify-between gap-3 p-4 text-sm">
        <span className="nums font-bold">
          #{toPersianDigits(order.orderNo)}
        </span>
        <span className="text-muted-foreground">شماره سفارش</span>
      </div>
      <div className="border-border flex items-center justify-between gap-3 border-t px-4 py-3 text-sm">
        <span className="nums">{formatJalali(order.createdAt)}</span>
        <span className="text-muted-foreground">تاریخ ثبت</span>
      </div>
      <div className="border-border flex items-center justify-between gap-3 border-t px-4 py-3 text-sm">
        <span>{PAYMENT_METHOD_LABELS[order.paymentMethod]}</span>
        <span className="text-muted-foreground">روش پرداخت</span>
      </div>
      <div className="border-border flex items-center justify-between gap-3 border-t px-4 py-3 text-sm">
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.badge}`}
        >
          {status.label}
        </span>
        <span className="text-muted-foreground">وضعیت سفارش</span>
      </div>
      <div className="border-border border-t p-4">
        <OrderSummary
          lines={toSummaryLines(order.items)}
          subtotal={order.subtotal}
          discount={order.discount}
          shippingFee={order.shippingFee}
          total={order.total}
        />
      </div>
    </div>
  );
  // An order still waiting for its receipt leads with the box to upload it in
  // — the copy above says it is right under it — then the card numbers, then
  // the order's details. Accepted, the details lead. One keyed list rather
  // than two places, so the box is moved, not mounted afresh, when the upload
  // it took re-renders the page as accepted.
  const sections =
    order.status === ORDER_STATUSES.AWAITING_RECEIPT
      ? [box, panel, details]
      : [details, panel, box];

  const { icon, ring } = {
    success: {
      icon: <Check size={36} className="text-success-strong" aria-hidden />,
      ring: 'bg-success-soft',
    },
    pending: {
      icon: <Clock size={36} className="text-warning" aria-hidden />,
      ring: 'bg-warning-soft',
    },
    failed: {
      icon: <XCircle size={36} className="text-destructive" aria-hidden />,
      ring: 'bg-destructive-soft',
    },
  }[view.kind];

  return (
    <main className="bg-secondary/20 min-h-screen pt-20">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-8">
        <div className="bg-card border-border rounded-3xl border p-8 text-center">
          <div
            className={`mx-auto mb-5 flex size-20 items-center justify-center rounded-full ${ring}`}
          >
            {icon}
          </div>
          <h1 className="mb-2 text-2xl font-black">{title}</h1>
          {/* Wraps anywhere: a cancellation reason is the admin's free text,
              and a pasted link is wider than a phone. */}
          <p className="text-muted-foreground mx-auto mb-7 max-w-md text-sm leading-relaxed wrap-anywhere">
            {sub}
          </p>

          {sections}

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            {view.showRetry && <RetryPaymentButton orderId={order.id} />}
            <Link
              href={PATHS.ACCOUNT}
              className="border-border hover:bg-secondary rounded-xl border-2 px-6 py-3 font-medium transition-colors"
              data-umami-event="checkout-result-my-orders"
            >
              سفارش‌های من
            </Link>
            <Link
              href={shopPath()}
              className="border-border hover:bg-secondary rounded-xl border-2 px-6 py-3 font-medium transition-colors"
              data-umami-event="checkout-result-continue-shopping"
            >
              ادامه خرید
            </Link>
          </div>
        </div>

        {view.kind !== 'success' && <SupportLine className="text-center" />}
      </div>
    </main>
  );
}
