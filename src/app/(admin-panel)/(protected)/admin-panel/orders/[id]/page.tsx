import { requireAdmin } from '@/lib/auth/session';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { z } from 'zod';
import { toLocalIranPhone } from '@/lib/auth/phone';
import { adminUserPath, PROTECTED_PATHS } from '@/lib/constant/paths';
import { formatJalali, formatToman, toPersianDigits } from '@/lib/format';
import {
  COURIER_FEE_TEXT,
  DELIVERY_METHODS,
  DELIVERY_METHOD_LABELS,
} from '@/lib/orders/delivery-method';
import {
  ORDER_STATUSES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
} from '@/lib/orders/order-status';
import {
  orderStatusBadge,
  paymentStatusBadge,
} from '@/lib/orders/order-status-display';
import { getAdminOrder } from '@/logic/orders/get-admin-order';
import { OrderReceipts } from '@/features/admin-panel/orders/order-receipts';
import { Pill } from '@/features/admin-panel/shared/pill';
import { OrderTransition } from '@/features/admin-panel/orders/order-transition';
import {
  PaymentRow,
  TotalsRow,
} from '@/features/admin-panel/orders/order-detail-rows';

export const metadata: Metadata = { title: 'جزئیات سفارش' };

// Reads the live order per request.
export const dynamic = 'force-dynamic';

/** The `[id]` segment is stranger input — reject a non-uuid before the DB. */
const idSchema = z.uuid();

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) notFound();

  // Not owner-scoped: the page has authorized an admin to read any order.
  // The projection excludes raw gatewayResponse, but still contains customer
  // and payment details that must never be read before the role check.
  const order = await getAdminOrder(parsed.data);
  if (!order) notFound();

  const badge = orderStatusBadge(order.status);

  return (
    <div className="max-w-4xl">
      <Link
        href={PROTECTED_PATHS.ORDERS}
        className="text-muted-foreground hover:text-foreground mb-5 flex items-center gap-2 text-sm"
        data-umami-event="admin-panel-order-back"
      >
        <ChevronRight size={14} aria-hidden="true" /> بازگشت به فهرست سفارش‌ها
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${badge.badge}`}
          >
            {badge.label}
          </span>
          {order.status === ORDER_STATUSES.CANCELLED &&
            order.cancellationReason && (
              // `wrap-anywhere`, not `wrap-break-word`: this sits in a flex
              // item, and only `anywhere` counts its breaks in the min-content
              // width, which is what lets the item shrink to the screen.
              <p className="text-muted-foreground mt-2 text-sm wrap-anywhere">
                دلیل لغو: {order.cancellationReason}
              </p>
            )}
        </div>
        <div className="text-end">
          <h1 className="nums text-2xl font-black">
            سفارش #{toPersianDigits(order.orderNo)}
          </h1>
          <p className="text-muted-foreground text-sm">
            {formatJalali(order.createdAt)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="border-border rounded-2xl border bg-white p-5">
            <h2 className="mb-1 font-bold">اقلام سفارش</h2>
            <p className="text-muted-foreground mb-3 text-xs">
              عنوان، SKU و قیمت واحد در زمان ثبت سفارش ذخیره شده‌اند و با تغییر
              محصول عوض نمی‌شوند.
            </p>
            <div className="divide-border divide-y">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-medium">
                      {item.title}
                    </p>
                    <p
                      className="text-muted-foreground nums truncate text-xs"
                      dir="ltr"
                    >
                      {item.sku}
                    </p>
                  </div>
                  <p className="text-muted-foreground nums shrink-0 text-xs">
                    {toPersianDigits(item.qty)} × {formatToman(item.unitPrice)}
                  </p>
                  <p className="nums w-28 shrink-0 text-end text-sm font-bold">
                    {formatToman(item.unitPrice * item.qty)}
                  </p>
                </div>
              ))}
            </div>
            <div className="border-border mt-1 space-y-2 border-t pt-3 text-sm">
              <TotalsRow
                label="جمع اقلام"
                value={formatToman(order.subtotal)}
              />
              <TotalsRow
                label={`هزینه ارسال (${order.provinceName})`}
                value={
                  order.deliveryMethod === DELIVERY_METHODS.COURIER
                    ? COURIER_FEE_TEXT
                    : formatToman(order.shippingFee)
                }
              />
              {order.discount > 0 && (
                <TotalsRow
                  label={`تخفیف${order.discountCode ? ` (${order.discountCode})` : ''}`}
                  value={`− ${formatToman(order.discount)}`}
                />
              )}
              <div className="border-border flex justify-between border-t pt-2 font-bold">
                <span className="nums">{formatToman(order.total)}</span>
                <span>جمع کل</span>
              </div>
            </div>
          </section>

          {order.paymentMethod === PAYMENT_METHODS.COD && (
            <OrderReceipts
              orderId={order.id}
              status={order.status}
              receipts={order.receipts}
            />
          )}

          <section className="border-border rounded-2xl border bg-white p-5">
            <h2 className="mb-1 font-bold">تغییر وضعیت</h2>
            <p className="text-muted-foreground mb-4 text-xs">
              فقط وضعیت‌های مجاز بعدی نمایش داده می‌شوند. «پرداخت شده» و
              «ناموفق» را درگاه تعیین می‌کند، نه اپراتور.
            </p>
            <OrderTransition orderId={order.id} status={order.status} />
          </section>
        </div>

        <div className="space-y-5">
          <section className="border-border rounded-2xl border bg-white p-5">
            <h2 className="mb-3 font-bold">مشتری</h2>
            <p className="font-medium">{order.recipientName}</p>
            <p className="text-muted-foreground nums text-sm" dir="ltr">
              {toPersianDigits(toLocalIranPhone(order.recipientPhone))}
            </p>
            {/* The card shows the delivery recipient, who may not be the
                account holder, so the link names the orderer's account. */}
            <Link
              href={adminUserPath(order.userId)}
              data-umami-event="admin-panel-order-customer-view"
              className="text-accent-strong mt-3 inline-flex items-center gap-1 text-sm font-medium underline"
            >
              مشاهده حساب سفارش‌دهنده
              <ChevronLeft size={14} aria-hidden="true" />
            </Link>
          </section>

          <section className="border-border rounded-2xl border bg-white p-5">
            <h2 className="mb-3 font-bold">آدرس تحویل</h2>
            <p className="mb-2 text-sm">
              <Pill
                tone={
                  order.deliveryMethod === DELIVERY_METHODS.COURIER
                    ? 'accent'
                    : 'muted'
                }
              >
                {DELIVERY_METHOD_LABELS[order.deliveryMethod]}
              </Pill>
            </p>
            <p className="mb-1 text-sm font-medium">{order.provinceName}</p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {order.city} · {order.addressLine}
            </p>
            <p className="text-muted-foreground nums mt-1 text-sm">
              کد پستی: {toPersianDigits(order.postalCode)}
            </p>
          </section>

          <section className="border-border rounded-2xl border bg-white p-5">
            <h2 className="mb-3 font-bold">پرداخت</h2>
            {order.payments.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                هنوز تراکنشی ثبت نشده است.
              </p>
            ) : (
              <div className="space-y-4">
                {order.payments.map((payment, index) => {
                  const status = paymentStatusBadge(payment.status);
                  return (
                    <div
                      key={index}
                      className="border-border space-y-2.5 border-b pb-4 text-sm last:border-0 last:pb-0"
                    >
                      {payment.needsManualRefund && (
                        <p
                          role="alert"
                          className="border-destructive/30 bg-destructive-soft text-destructive rounded-lg border p-3 font-bold"
                        >
                          نیاز به بازپرداخت دستی: مبلغ دریافت شده اما به این
                          سفارش تخصیص نیافته است. پرداخت را بررسی و وجه را
                          بازگردانید.
                        </p>
                      )}
                      <PaymentRow
                        label="روش"
                        value={PAYMENT_METHOD_LABELS[payment.method]}
                      />
                      <div className="flex items-center justify-between gap-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.badge}`}
                        >
                          {status.label}
                        </span>
                        <span className="text-muted-foreground">وضعیت</span>
                      </div>
                      <PaymentRow
                        label="مبلغ"
                        value={formatToman(payment.amount)}
                      />
                      {/* Authority and ref id are opaque gateway keys an admin
                          copies verbatim into Zarinpal's panel to reconcile —
                          render them as-is, never Persian-digit folded. */}
                      <PaymentRow
                        label="شناسه پرداخت"
                        value={payment.authority ?? '—'}
                        ltr
                      />
                      <PaymentRow
                        label="کد پیگیری"
                        value={payment.refId ?? '—'}
                        ltr
                      />
                      {payment.cardPan && (
                        <PaymentRow
                          label="کارت"
                          value={toPersianDigits(payment.cardPan)}
                          ltr
                        />
                      )}
                      {payment.paidAt && (
                        <PaymentRow
                          label="زمان پرداخت"
                          value={formatJalali(payment.paidAt)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
