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
import { RetryPaymentButton } from '@/features/checkout/retry-payment-button';
import { SupportLine } from '@/features/checkout/support-line';
import { resultView } from '@/lib/checkout/result-view';
import { PATHS, checkoutResultPath, shopPath } from '@/lib/constant/paths';
import { formatJalali, toPersianDigits } from '@/lib/format';
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
} from '@/lib/orders/order-status';

export const metadata: Metadata = { title: 'نتیجه سفارش' };

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
  const order = await loadOwnedOrder(
    (await params).orderId,
    checkoutResultPath,
  );

  const view = resultView(order.status);
  const isCod = order.paymentMethod === PAYMENT_METHODS.COD;
  // A card-to-card order is created unpaid: show where to send the money again,
  // but only on the success view — a cancelled one has nothing left to pay.
  const cardToCard =
    isCod && view.kind === 'success' ? await readCardToCardPayment() : null;

  const copy = {
    success: {
      icon: <Check size={36} className="text-success-strong" aria-hidden />,
      ring: 'bg-success-soft',
      title: isCod ? 'سفارش ثبت شد!' : 'پرداخت موفق بود!',
      sub: isCod
        ? 'مبلغ سفارش را کارت به کارت کن و رسید را برای ما بفرست تا سفارش ارسال شود.'
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
              <span>{PAYMENT_METHOD_LABELS[order.paymentMethod]}</span>
              <span className="text-muted-foreground">روش پرداخت</span>
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

          {cardToCard && (
            <CardToCardPanel payment={cardToCard} className="mb-7" />
          )}

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
