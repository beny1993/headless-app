'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { DEFAULT_SITE_NAME } from '@/constants';
import { PATHS } from '@/lib/constant/paths';
import { vazirmatn } from '@/lib/fonts';
import './globals.css';

/* The last resort: a crash in the root layout itself, which replaces the whole
   document — hence its own <html>/<body>. It therefore cannot use the storefront
   chrome (`readSiteChrome` reads the database, and a page that renders *because*
   something is broken must not depend on anything that might be the broken
   thing) and cannot use next/link's prefetch against a router that just died —
   a plain <a> is the reload this page wants anyway.

   `lang="fa" dir="rtl"` and the self-hosted Vazirmatn are not decoration: this
   is the one page guaranteed to render when everything else fails, and an
   English LTR fallback in front of a Persian shopper is its own bug. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="fa" dir="rtl">
      <body className={`${vazirmatn.variable} font-sans antialiased`}>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-2xl font-semibold">مشکلی پیش آمد</h1>
          <p className="text-muted-foreground text-sm">
            خطایی غیرمنتظره رخ داد. لطفاً دوباره تلاش کنید؛ اگر باز هم تکرار شد،
            کمی بعد سر بزنید.
          </p>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={reset}
              className="text-sm font-medium underline underline-offset-4"
              data-umami-event="global-error-retry-button"
            >
              تلاش دوباره
            </button>
            <a
              href={PATHS.HOME}
              className="text-sm font-medium underline underline-offset-4"
              data-umami-event="global-error-home-link"
            >
              بازگشت به {DEFAULT_SITE_NAME}
            </a>
          </div>
          {/* The one string Sentry and the shopper can both quote back. */}
          {error.digest ? (
            <p className="text-muted-foreground text-xs">
              کد خطا: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
