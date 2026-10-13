'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, XCircle } from 'lucide-react';
import { useHydrated } from '@/hooks/use-hydrated';
import { postData } from '@/lib/api-client';
import { reasonFrom } from '@/lib/checkout/field-errors';
import { apiOrderCancelPath } from '@/lib/constant/paths';

/**
 * «لغو سفارش» on the account page of an open order — one still waiting for its
 * receipt or its online payment. Asks once before it sends; the server decides
 * (owner, still open) and the page re-renders from the cancelled order.
 *
 * Each step swaps out the button just pressed, so focus is placed by hand:
 * opening the question focuses «نه، بماند», the safe choice, inside a group the
 * question names (a screen reader reads it with the button), and «نه، بماند»
 * hands focus back to «لغو سفارش». Every control is at least 44px tall.
 */
export function CancelOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const questionId = useId();
  const openButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  // Whether the question was open on the last render: closing it, not the
  // first render, is what returns focus to «لغو سفارش».
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (confirming) keepButton.current?.focus();
    else if (wasConfirming.current) openButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

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
        <div
          role="group"
          aria-labelledby={questionId}
          // Question and buttons share a row from `sm` up. On a phone the
          // buttons go under the question: beside them, it had a column a word
          // or two wide.
          className="border-border flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center"
        >
          <p id={questionId} className="min-w-0 text-sm sm:flex-1">
            این سفارش لغو شود؟ اقلام آن به فروشگاه برمی‌گردند.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={cancel}
              disabled={busy}
              className="bg-destructive min-h-11 rounded-xl px-4 py-2 text-sm font-bold text-white transition-opacity disabled:opacity-60"
              data-umami-event="account-order-cancel-confirm"
            >
              {busy ? 'در حال لغو…' : 'بله، لغو کن'}
            </button>
            <button
              ref={keepButton}
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="border-border hover:bg-secondary min-h-11 rounded-xl border-2 px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
              data-umami-event="account-order-cancel-keep"
            >
              نه، بماند
            </button>
          </div>
        </div>
      ) : (
        <button
          ref={openButton}
          type="button"
          onClick={() => setConfirming(true)}
          // Until hydration a tap would be dropped (`useHydrated` says why).
          // The question's own buttons only ever render after it.
          disabled={!hydrated}
          className="text-destructive hover:bg-destructive-soft/40 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors"
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
