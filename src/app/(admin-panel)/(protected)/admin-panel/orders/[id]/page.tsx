import { requireAdmin } from '@/lib/auth/session';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { z } from 'zod';
import { toLocalIranPhone } from '@/lib/auth/phone';
import { PROTECTED_PATHS } from '@/lib/constant/paths';
import { formatJalali, formatToman, toPersianDigits } from '@/lib/format';
import { PAYMENT_METHODS } from '@/lib/orders/order-status';
import {
  orderStatusBadge,
  paymentStatusBadge,
} from '@/lib/orders/order-status-display';
import { getAdminOrder } from '@/logic/orders/get-admin-order';
import { OrderTransition } from '@/features/admin-panel/orders/order-transition';

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
        <span
          className={`rounded-full px-3 py-1.5 text-xs font-medium ${badge.badge}`}
        >
          {badge.label}
        </span>
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
              <Row label="جمع اقلام" value={formatToman(order.subtotal)} />
              <Row
                label={`هزینه ارسال (${order.provinceName})`}
                value={formatToman(order.shippingFee)}
              />
              {order.discount > 0 && (
                <Row
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
          </section>

          <section className="border-border rounded-2xl border bg-white p-5">
            <h2 className="mb-3 font-bold">آدرس تحویل</h2>
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
                      <PayRow
                        label="روش"
                        value={
                          payment.method === PAYMENT_METHODS.COD
                            ? 'پرداخت در محل'
                            : 'زرین‌پال'
                        }
                      />
                      <div className="flex items-center justify-between gap-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.badge}`}
                        >
                          {status.label}
                        </span>
                        <span className="text-muted-foreground">وضعیت</span>
                      </div>
                      <PayRow
                        label="مبلغ"
                        value={formatToman(payment.amount)}
                      />
                      {/* Authority and ref id are opaque gateway keys an admin
                          copies verbatim into Zarinpal's panel to reconcile —
                          render them as-is, never Persian-digit folded. */}
                      <PayRow
                        label="شناسه پرداخت"
                        value={payment.authority ?? '—'}
                        ltr
                      />
                      <PayRow
                        label="کد پیگیری"
                        value={payment.refId ?? '—'}
                        ltr
                      />
                      {payment.cardPan && (
                        <PayRow
                          label="کارت"
                          value={toPersianDigits(payment.cardPan)}
                          ltr
                        />
                      )}
                      {payment.paidAt && (
                        <PayRow
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function PayRow({
  label,
  value,
  ltr,
}: {
  label: string;
  value: string;
  ltr?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={ltr ? 'nums' : ''} dir={ltr ? 'ltr' : undefined}>
        {value}
      </span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
