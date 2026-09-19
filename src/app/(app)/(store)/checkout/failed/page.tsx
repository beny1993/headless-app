import type { Metadata } from 'next';
import Link from 'next/link';
import { XCircle } from 'lucide-react';
import { PATHS, shopPath } from '@/lib/constant/paths';
import { toPersianDigits } from '@/lib/format';

export const metadata: Metadata = { title: 'پرداخت ناموفق' };

/**
 * The generic payment-failure page. The Zarinpal callback lands here (302 from
 * `checkoutFailurePath`) only when it cannot tie the redirect to an order — an
 * unknown or absent authority, or a malformed callback query — so there is no
 * order id and no order summary to show, unlike `/checkout/result/[orderId]`.
 *
 * The page body itself reads nothing and says the same thing every time — but it
 * is `ƒ` (dynamic) in the build legend, not `○`, because its `(app)` layout now
 * reads the header/footer content per request (`await connection()`). That is by
 * design: a 404 or a failed checkout must still show the admin's live chrome.
 */
export default function Page() {
  return (
    <main className="bg-secondary/20 min-h-screen pt-20">
      <div className="mx-auto max-w-md px-4 py-16 sm:px-8">
        <div className="bg-card border-border rounded-3xl border p-8 text-center">
          <div className="bg-destructive-soft mx-auto mb-5 flex size-20 items-center justify-center rounded-full">
            <XCircle
              size={36}
              className="text-destructive"
              aria-hidden="true"
            />
          </div>
          <h1 className="mb-2 text-2xl font-black">پرداخت ناموفق بود</h1>
          <p className="text-muted-foreground mb-7 text-sm leading-relaxed">
            نتیجهٔ پرداخت به سفارشی ربط داده نشد و مبلغی از حساب شما کسر نشده
            است. اگر سبد خریدت را ثبت کرده‌ای، وضعیت آن را در «سفارش‌های من»
            ببین؛ در غیر این صورت می‌توانی دوباره خرید کنی.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href={shopPath()}
              className="bg-brand hover:bg-brand-hover text-brand-foreground rounded-xl px-6 py-3 font-bold transition-colors"
              data-umami-event="checkout-failed-continue-shopping"
            >
              بازگشت به فروشگاه
            </Link>
            <Link
              href={PATHS.ACCOUNT}
              className="border-border hover:bg-secondary rounded-xl border-2 px-6 py-3 font-medium transition-colors"
              data-umami-event="checkout-failed-my-orders"
            >
              سفارش‌های من
            </Link>
          </div>
          <p className="text-muted-foreground mt-6 text-xs">
            شماره پشتیبانی:{' '}
            <span dir="ltr" className="nums">
              {toPersianDigits('021-1234567')}
            </span>{' '}
            — هر روز ۹ تا ۱۸
          </p>
        </div>
      </div>
    </main>
  );
}
