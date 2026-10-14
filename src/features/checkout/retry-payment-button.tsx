'use client';

import { useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useHydrated } from '@/hooks/use-hydrated';
import { reasonFrom } from '@/lib/checkout/field-errors';
import { startZarinpalPayment } from '@/lib/checkout/start-zarinpal-payment';

/**
 * "Retry payment" for a `pending_payment` order on the result page — the only
 * interactive piece of that otherwise server-rendered page, so only `orderId`
 * crosses to the client; `startZarinpalPayment` does the rest.
 */
export function RetryPaymentButton({ orderId }: { orderId: string }) {
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const retry = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await startZarinpalPayment(orderId);
    } catch (caught) {
      setError(reasonFrom(caught) ?? 'شروع پرداخت ناموفق بود.');
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={retry}
        // Until hydration a tap would be dropped (`useHydrated` says why).
        disabled={busy || !hydrated}
        className="bg-brand hover:bg-brand-hover text-brand-foreground flex items-center justify-center gap-2 rounded-xl px-6 py-3 font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        data-umami-event="checkout-result-retry-pay"
      >
        <RefreshCw size={16} aria-hidden="true" />{' '}
        {busy ? 'در حال انتقال…' : 'تلاش دوباره برای پرداخت'}
      </button>
      {error && (
        <p
          role="alert"
          className="text-destructive flex items-center gap-1 text-xs"
        >
          <AlertCircle size={12} aria-hidden="true" /> {error}
        </p>
      )}
    </div>
  );
}
