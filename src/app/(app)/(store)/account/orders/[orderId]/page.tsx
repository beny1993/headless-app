import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, Clock, XCircle } from 'lucide-react';
import { loadOwnedOrder } from '@/features/checkout/load-owned-order';
import {
  OrderSummary,
  toSummaryLines,
} from '@/features/checkout/order-summary';
import { ReceiptBox } from '@/features/checkout/receipt-box';
import { CancelOrderButton } from '@/features/checkout/cancel-order-button';
import { RetryPaymentButton } from '@/features/checkout/retry-payment-button';
import { SupportLine } from '@/features/checkout/support-line';
import {
  cancellationNote,
  resultCopy,
  resultView,
} from '@/lib/checkout/result-view';
import {
  accountOrderPath,
  checkoutResumePath,
  PATHS,
} from '@/lib/constant/paths';
import {
  formatJalali,
  formatJalaliDateTime,
  toPersianDigits,
} from '@/lib/format';
import { DELIVERY_METHOD_LABELS } from '@/lib/orders/delivery-method';
import {
  OPEN_ORDER_STATUSES,
  ORDER_STATUSES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '@/lib/orders/order-status';
import {
  orderStatusBadge,
  paymentStatusBadge,
} from '@/lib/orders/order-status-display';

export const metadata: Metadata = { title: 'جزئیات سفارش' };

/**
 * One of the customer's own orders, in full: snapshotted items and totals, the
 * delivery address, and the payment method/status — plus a "pay now" banner while
 * the order is still `pending_payment`, a «not accepted yet» banner while a
 * card-to-card order still waits for its receipt, «لغو سفارش» while the order
 * is open, the receipt once it is in, and the reason once it is cancelled —
 * with the support number wherever a banner sends the shopper to support.
 *
 * A server component, owner-scoped by the session id through `getOwnedOrder`: a
 * missing order and one that belongs to someone else are the same `notFound()`,
 * so the page never confirms another customer's order exists. Keyed on the uuid
 * `id`, never the enumerable `order_no`. `getOwnedOrder` already returns the SAFE
 * payment projection (no gateway secrets), so nothing sensitive can render here.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const order = await loadOwnedOrder((await params).orderId, accountOrderPath);

  const status = orderStatusBadge(order.status);
  const view = resultView(order.status);

  // A representative payment for the status line: a settled one if there is one,
  // else the most recent attempt. COD before delivery has a single pending row.
  const payment =
    order.payments.find((p) => p.status === PAYMENT_STATUSES.PAID) ??
    order.payments.at(-1);
  const cancelled = order.status === ORDER_STATUSES.CANCELLED;
  // A card-to-card order whose receipt never arrived: the result page's own
  // words, so the two pages cannot disagree about whether it was accepted.
  const waiting =
    order.status === ORDER_STATUSES.AWAITING_RECEIPT
      ? resultCopy(order, order.receipts.length)
      : null;
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
      eventPrefix="account-order"
    />
  );

  return (
    <main className="min-h-screen pt-4">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
        <Link
          href={PATHS.ACCOUNT}
          className="text-muted-foreground hover:text-foreground mb-5 flex items-center gap-2 text-sm"
          data-umami-event="account-order-back"
        >
          <ChevronRight size={14} aria-hidden="true" /> بازگشت به سفارش‌ها
        </Link>

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <span
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${status.badge}`}
          >
            {status.label}
          </span>
          <div className="text-end">
            <h1 className="text-xl font-bold">
              سفارش #{toPersianDigits(order.orderNo)}
            </h1>
            <p className="text-muted-foreground text-sm">
              {formatJalali(order.createdAt)}
            </p>
          </div>
        </div>

        {view.showRetry && (
          <div className="bg-warning-soft border-warning/30 mb-5 flex flex-wrap items-start gap-3 rounded-2xl border p-4">
            <Clock
              size={18}
              className="text-warning mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                این سفارش هنوز پرداخت نشده است
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                اقلام برایت نگه داشته شده‌اند؛ می‌توانی همین حالا پرداخت را کامل
                کنی.
              </p>
            </div>
            <RetryPaymentButton orderId={order.id} />
          </div>
        )}

        {waiting && (
          <div className="bg-warning-soft border-warning/30 mb-5 flex items-start gap-3 rounded-2xl border p-4">
            <Clock
              size={18}
              className="text-warning mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{waiting.title}</p>
              <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                {waiting.sub}
              </p>
              {/* Back to the one place a receipt is sent: the checkout's retry. */}
              <Link
                href={checkoutResumePath(order.id)}
                className="bg-brand hover:bg-brand-hover text-brand-foreground mt-3 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold transition-colors"
                data-umami-event="account-order-send-receipt"
              >
                ارسال رسید
              </Link>
              <SupportLine className="mt-1" />
            </div>
          </div>
        )}

        {/* An open order — the kind checkout's open-order cap counts — is the
            shopper's to cancel. */}
        {OPEN_ORDER_STATUSES.includes(order.status) && (
          <CancelOrderButton orderId={order.id} />
        )}

        {cancelled && (
          <div className="bg-destructive-soft border-destructive/30 mb-5 flex items-start gap-3 rounded-2xl border p-4">
            <XCircle
              size={18}
              className="text-destructive mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">این سفارش لغو شد.</p>
              {cancellationNote(order) && (
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed wrap-anywhere">
                  {cancellationNote(order)}
                </p>
              )}
              {/* A card-to-card note sends a shopper who paid to support. */}
              {order.paymentMethod === PAYMENT_METHODS.COD && (
                <SupportLine className="mt-1" />
              )}
            </div>
          </div>
        )}

        {box}

        <div className="bg-card border-border mb-5 rounded-2xl border p-5">
          <h2 className="mb-3 font-bold">اقلام سفارش</h2>
          <OrderSummary
            lines={toSummaryLines(order.items)}
            subtotal={order.subtotal}
            discount={order.discount}
            shippingFee={order.shippingFee}
            total={order.total}
            deliveryMethod={order.deliveryMethod}
          />
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="bg-card border-border rounded-2xl border p-5">
            <h2 className="mb-3 font-bold">آدرس تحویل</h2>
            <p className="mb-1 text-sm font-medium">{order.provinceName}</p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              روش ارسال: {DELIVERY_METHOD_LABELS[order.deliveryMethod]}
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {order.recipientName} · {order.city}
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {order.addressLine}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              کد پستی: {toPersianDigits(order.postalCode)}
            </p>
          </div>

          <div className="bg-card border-border rounded-2xl border p-5">
            <h2 className="mb-3 font-bold">پرداخت</h2>
            <div className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">
                  {PAYMENT_METHOD_LABELS[order.paymentMethod]}
                </span>
                <span className="text-muted-foreground">روش</span>
              </div>
              {payment && (
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${paymentStatusBadge(payment.status).badge}`}
                  >
                    {paymentStatusBadge(payment.status).label}
                  </span>
                  <span className="text-muted-foreground">وضعیت پرداخت</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
