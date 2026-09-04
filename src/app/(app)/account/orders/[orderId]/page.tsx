import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight, Clock } from 'lucide-react';
import { z } from 'zod';
import {
  OrderSummary,
  type SummaryLine,
} from '@/features/checkout/order-summary';
import { RetryPaymentButton } from '@/features/checkout/retry-payment-button';
import { requireSession } from '@/lib/auth/session';
import { resultView } from '@/lib/checkout/result-view';
import { accountOrderPath, PATHS } from '@/lib/constant/paths';
import { formatJalali, toPersianDigits } from '@/lib/format';
import { PAYMENT_METHODS, PAYMENT_STATUSES } from '@/lib/orders/order-status';
import {
  orderStatusBadge,
  paymentStatusBadge,
} from '@/lib/orders/order-status-display';
import { getOwnedOrder } from '@/logic/checkout/get-order';

export const metadata: Metadata = { title: 'جزئیات سفارش' };

/** The `[orderId]` path segment is a stranger's input — reject a non-uuid. */
const orderIdSchema = z.uuid();

/**
 * One of the customer's own orders, in full: snapshotted items and totals, the
 * delivery address, and the payment method/status — plus a "pay now" banner while
 * the order is still `pending_payment`.
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
  const { orderId } = await params;
  const parsed = orderIdSchema.safeParse(orderId);
  if (!parsed.success) notFound();

  const session = await requireSession(accountOrderPath(parsed.data));
  const order = await getOwnedOrder(parsed.data, session.user.id);
  if (!order) notFound();

  const status = orderStatusBadge(order.status);
  const view = resultView(order.status);
  const isCod = order.paymentMethod === PAYMENT_METHODS.COD;

  const summaryLines: SummaryLine[] = order.items.map((item) => ({
    id: item.id,
    title: item.title,
    qty: item.qty,
    lineTotal: item.unitPrice * item.qty,
  }));

  // A representative payment for the status line: a settled one if there is one,
  // else the most recent attempt. COD before delivery has a single pending row.
  const payment =
    order.payments.find((p) => p.status === PAYMENT_STATUSES.PAID) ??
    order.payments.at(-1);

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

        <div className="bg-card border-border mb-5 rounded-2xl border p-5">
          <h2 className="mb-3 font-bold">اقلام سفارش</h2>
          <OrderSummary
            lines={summaryLines}
            subtotal={order.subtotal}
            shippingFee={order.shippingFee}
            total={order.total}
          />
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="bg-card border-border rounded-2xl border p-5">
            <h2 className="mb-3 font-bold">آدرس تحویل</h2>
            <p className="mb-1 text-sm font-medium">{order.provinceName}</p>
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
                  {isCod ? 'پرداخت در محل' : 'زرین‌پال'}
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
