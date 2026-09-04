import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Check, Clock, XCircle } from 'lucide-react';
import { z } from 'zod';
import {
  OrderSummary,
  type SummaryLine,
} from '@/features/checkout/order-summary';
import { RetryPaymentButton } from '@/features/checkout/retry-payment-button';
import { requireSession } from '@/lib/auth/session';
import { resultView } from '@/lib/checkout/result-view';
import { PATHS, checkoutResultPath, shopPath } from '@/lib/constant/paths';
import { formatJalali, toPersianDigits } from '@/lib/format';
import { PAYMENT_METHODS } from '@/lib/orders/order-status';
import { getOwnedOrder } from '@/logic/checkout/get-order';

export const metadata: Metadata = { title: 'نتیجه سفارش' };

/** The `[orderId]` path segment is a stranger's input — reject a non-uuid. */
const orderIdSchema = z.uuid();

/**
 * The one checkout result page, for COD confirmation and every Zarinpal outcome.
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
  const { orderId } = await params;
  const parsed = orderIdSchema.safeParse(orderId);
  if (!parsed.success) notFound();

  const session = await requireSession(checkoutResultPath(parsed.data));
  const order = await getOwnedOrder(parsed.data, session.user.id);
  // Missing and not-owned are the same 404 — the page never leaks that someone
  // else's order exists.
  if (!order) notFound();

  const view = resultView(order.status);
  const isCod = order.paymentMethod === PAYMENT_METHODS.COD;

  const copy = {
    success: {
      icon: <Check size={36} className="text-success-strong" aria-hidden />,
      ring: 'bg-success-soft',
      title: isCod ? 'سفارش ثبت شد!' : 'پرداخت موفق بود!',
      sub: isCod
        ? 'مبلغ سفارش هنگام تحویل دریافت می‌شود.'
        : 'پرداخت شما با موفقیت تایید شد.',
    },
    pending: {
      icon: <Clock size={36} className="text-warning" aria-hidden />,
      ring: 'bg-warning-soft',
      title: 'در انتظار تایید پرداخت',
      sub: 'پرداخت این سفارش هنوز کامل نشده است. اگر مبلغ از حسابت کم شده تا ۷۲ ساعت تسویه می‌شود؛ در غیر این صورت می‌توانی دوباره برای پرداخت اقدام کنی.',
    },
    failed: {
      icon: <XCircle size={36} className="text-destructive" aria-hidden />,
      ring: 'bg-destructive-soft',
      title: 'پرداخت ناموفق یا منقضی شد',
      sub: 'پرداخت این سفارش کامل نشد و مبلغی از حساب شما کسر نشده است. برای خرید می‌توانی دوباره اقدام کنی.',
    },
  }[view.kind];

  const summaryLines: SummaryLine[] = order.items.map((item) => ({
    id: item.id,
    title: item.title,
    qty: item.qty,
    lineTotal: item.unitPrice * item.qty,
  }));

  return (
    <main className="bg-secondary/20 min-h-screen pt-20">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-8">
        <div className="bg-card border-border rounded-3xl border p-8 text-center">
          <div
            className={`mx-auto mb-5 flex size-20 items-center justify-center rounded-full ${copy.ring}`}
          >
            {copy.icon}
          </div>
          <h1 className="mb-2 text-2xl font-black">{copy.title}</h1>
          <p className="text-muted-foreground mx-auto mb-7 max-w-md text-sm leading-relaxed">
            {copy.sub}
          </p>

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
              <span>{isCod ? 'پرداخت در محل' : 'زرین‌پال'}</span>
              <span className="text-muted-foreground">روش پرداخت</span>
            </div>
            <div className="border-border border-t p-4">
              <OrderSummary
                lines={summaryLines}
                subtotal={order.subtotal}
                shippingFee={order.shippingFee}
                total={order.total}
              />
            </div>
          </div>

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

        {view.kind !== 'success' && (
          <p className="text-muted-foreground mt-6 text-center text-xs">
            شماره پشتیبانی:{' '}
            <span dir="ltr" className="nums">
              {toPersianDigits('021-1234567')}
            </span>{' '}
            — هر روز ۹ تا ۱۸
          </p>
        )}
      </div>
    </main>
  );
}
