'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertCircle, XCircle } from 'lucide-react';
import { postData } from '@/lib/api-client';
import { reasonFrom } from '@/lib/checkout/field-errors';
import { apiOrderCancelPath } from '@/lib/constant/paths';

/**
 * «لغو سفارش» on the account page of an open order — one still waiting for its
 * receipt or its online payment. Asks once before it sends; the server decides
 * (owner, still open) and the page re-renders from the cancelled order.
 */
export function CancelOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await postData(apiOrderCancelPath(orderId));
      router.refresh();
    } catch (caught) {
      setError(reasonFrom(caught) ?? 'لغو سفارش انجام نشد.');
      setBusy(false);
    }
  };

  return (
    <div className="mb-5">
      {confirming ? (
        <div className="border-border flex flex-wrap items-center gap-3 rounded-2xl border p-4">
          <p className="min-w-0 flex-1 text-sm">
            این سفارش لغو شود؟ اقلام آن به فروشگاه برمی‌گردند.
          </p>
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="bg-destructive rounded-xl px-4 py-2 text-sm font-bold text-white transition-opacity disabled:opacity-60"
            data-umami-event="account-order-cancel-confirm"
          >
            {busy ? 'در حال لغو…' : 'بله، لغو کن'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="border-border hover:bg-secondary rounded-xl border-2 px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
            data-umami-event="account-order-cancel-keep"
          >
            نه، بماند
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-destructive hover:bg-destructive-soft/40 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors"
          data-umami-event="account-order-cancel"
        >
          <XCircle size={16} aria-hidden="true" />
          لغو سفارش
        </button>
      )}
      {error && (
        <p
          role="alert"
          className="text-destructive mt-2 flex items-center gap-1 text-xs"
        >
          <AlertCircle size={12} aria-hidden="true" /> {error}
        </p>
      )}
    </div>
  );
}
