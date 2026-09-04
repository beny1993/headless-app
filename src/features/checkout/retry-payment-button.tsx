'use client';

import { useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { postData } from '@/lib/api-client';
import { API_PATHS } from '@/lib/constant/paths';

/**
 * "Retry payment" for a `pending_payment` order on the result page — the only
 * interactive piece of that otherwise server-rendered page, so only `orderId`
 * crosses to the client. It starts a fresh Zarinpal attempt
 * (`POST /api/payments/zarinpal/request`, which mints a new authority) and sends
 * the browser to the returned gateway URL. The order id is the sole input; the
 * endpoint re-checks ownership and that the order is still awaiting payment.
 */
export function RetryPaymentButton({ orderId }: { orderId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const retry = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const { redirectUrl } = await postData<{ redirectUrl: string }>(
        API_PATHS.PAYMENT_REQUEST,
        { orderId },
      );
      window.location.assign(redirectUrl);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'شروع پرداخت ناموفق بود.',
      );
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={retry}
        disabled={busy}
        className="bg-accent-strong hover:bg-accent-hover flex items-center justify-center gap-2 rounded-xl px-6 py-3 font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
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
