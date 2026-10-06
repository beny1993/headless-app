import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, Clock, XCircle } from 'lucide-react';
import { loadOwnedOrder } from '@/features/checkout/load-owned-order';
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
import { PAYMENT_METHOD_LABELS } from '@/lib/orders/order-status';
import { orderStatusBadge } from '@/lib/orders/order-status-display';

export const metadata: Metadata = { title: 'نتیجه سفارش' };

/**
 * The one checkout result page, for a card-to-card order (the receipt its
 * checkout uploaded, once it is in) and every Zarinpal outcome.
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
  // The receipt the checkout uploaded, once it is in. Nothing to upload or
  // pay with here: the checkout's screenshot is the one way a receipt arrives.
  const box = order.receipts.length > 0 && (
    <ReceiptBox
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
    <div className="border-border mb-7 overflow-hidden rounded-2xl border text-start">
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

          {details}
          {box}

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
