'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ApiRequestError, postForm } from '@/lib/api-client';
import {
  apiOrderReceiptPath,
  apiOrderReceiptsPath,
} from '@/lib/constant/paths';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type OrderStatus,
} from '@/lib/orders/order-status';
import {
  acceptsReceipts,
  MAX_RECEIPTS_PER_ORDER,
  OPENS_IN_NEW_TAB,
  RECEIPT_CAP_MESSAGE,
  receiptAlt,
  receiptSchema,
  receiptsLabel,
} from '@/lib/orders/receipt';
import { IMAGE_FIELD_NAME } from '@/lib/storage/image-upload';
import { ReceiptPicker } from './receipt-picker';

const UPLOAD_FAILED = 'بارگذاری رسید ناموفق بود. دوباره تلاش کن.';

/**
 * The server's own sentence for a refusal it explained — a 4xx, or the 503 that
 * says storage cannot keep a receipt private right now — else a generic one. A
 * 5xx message outside that is a developer's, never a shopper's.
 */
const refusalOf = (error: unknown): string =>
  error instanceof ApiRequestError &&
  (error.status < 500 || error.status === 503)
    ? error.message
    : UPLOAD_FAILED;

/** What the box says about the order, by its status — not by the count. */
const stateLine = (status: OrderStatus, receiptCount: number) => {
  if (status === ORDER_STATUSES.AWAITING_RECEIPT) {
    return 'هنوز رسیدی دریافت نشده است. پس از واریز، رسید را همین‌جا بارگذاری کن.';
  }
  if (status === ORDER_STATUSES.PROCESSING) {
    return receiptCount > 0
      ? 'رسید دریافت شد و سفارش پذیرفته شد؛ پس از بررسی رسید، ارسال می‌شود.'
      : 'سفارش پذیرفته شد؛ رسید را می‌توانی همین‌جا بارگذاری کنی.';
  }
  return null;
};

/**
 * The card-to-card receipt box, on the checkout result page and the account
 * order page: the receipts already uploaded (thumbnails through the owner's
 * authenticated route, never a public URL and never `next/image`) and, while
 * the order takes receipts, a picker (`ReceiptPicker`) and an upload button.
 *
 * Deliberately no copy of the order's state: an upload calls `router.refresh()`
 * and the server re-renders the page — badge, sub-copy, this box — from the
 * order as it now is (the first receipt accepts it). Only the pick, `busy` and
 * the refusal are local; `busy` clears in `finally`, because a refresh keeps
 * this component mounted and a lingering `busy` would strand the button. Both
 * pages keep it mounted even when the refresh moves it, from first on a
 * waiting order to below on an accepted one: they key it in one list (their
 * page tests pin the single mount).
 */
export function ReceiptBox({
  orderId,
  orderStatus,
  receipts,
  eventPrefix,
}: {
  orderId: string;
  orderStatus: OrderStatus;
  /** Oldest first; `uploadedAt` already formatted by the page (Jalali date and time). */
  receipts: { id: string; uploadedAt: string }[];
  eventPrefix: 'checkout-result' | 'account-order';
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only card-to-card orders get this box, so the method is not a question.
  const accepting = acceptsReceipts({
    paymentMethod: PAYMENT_METHODS.COD,
    status: orderStatus,
  });
  const atCap = receipts.length >= MAX_RECEIPTS_PER_ORDER;
  const line = stateLine(orderStatus, receipts.length);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      // Named «receipt», never the shopper's own file name.
      form.append(IMAGE_FIELD_NAME, file, 'receipt');
      await postForm(apiOrderReceiptsPath(orderId), form, receiptSchema);
      setFile(null);
      router.refresh();
    } catch (uploadError) {
      setError(refusalOf(uploadError));
      // A 409: the order moved on under the shopper (shipped, cancelled, or
      // holding all its receipts). Re-render from it, so the box stops
      // offering what the order no longer takes; the refusal stays in the
      // alert, and a full box leaves the cap's sentence to it.
      if (
        uploadError instanceof ApiRequestError &&
        uploadError.status === 409
      ) {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-card border-border mb-7 rounded-2xl border p-5 text-start">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">رسید پرداخت</h2>
        {receipts.length > 0 && (
          <span className="bg-secondary rounded-full px-2.5 py-1 text-xs font-medium">
            {receiptsLabel(orderStatus)}
          </span>
        )}
      </div>

      {line && (
        <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
          {line}
        </p>
      )}

      {receipts.length > 0 && (
        <ul className="mb-4 flex flex-wrap gap-3">
          {receipts.map((receipt, index) => {
            const url = apiOrderReceiptPath(orderId, receipt.id);
            return (
              <li key={receipt.id} className="w-24">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener"
                  data-umami-event={`${eventPrefix}-receipt-open`}
                  className="border-border block overflow-hidden rounded-xl border"
                >
                  {/* A plain <img>, never next/image: the receipt comes from
                      this app's own authenticated, uncacheable route — not
                      the bucket the lint rule is about — and the optimizer
                      would fetch it without the shopper's session, then keep
                      a copy in its cache. */}
                  {/* eslint-disable-next-line no-restricted-syntax */}
                  <img
                    src={url}
                    alt={receiptAlt(index + 1)}
                    loading="lazy"
                    className="size-24 object-cover"
                  />
                  <span className="sr-only">{OPENS_IN_NEW_TAB}</span>
                </a>
                <p className="text-muted-foreground nums mt-1 text-center text-xs">
                  {receipt.uploadedAt}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {/* Not when the alert below already says it: a 409 that found the
          order full puts this same sentence there. */}
      {accepting && atCap && error !== RECEIPT_CAP_MESSAGE && (
        <p className="text-muted-foreground text-sm">{RECEIPT_CAP_MESSAGE}</p>
      )}

      <ReceiptPicker
        id={`${eventPrefix}-receipt-file`}
        event={`${eventPrefix}-receipt-file`}
        file={file}
        error={error}
        controls={accepting && !atCap}
        onPick={(pick) => {
          setError(pick.error);
          setFile(pick.file);
        }}
      >
        <button
          type="button"
          onClick={upload}
          disabled={!file || busy}
          data-umami-event={`${eventPrefix}-receipt-upload`}
          className="bg-accent-strong hover:bg-accent-hover inline-flex min-h-11 items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
        >
          {busy && (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          )}
          بارگذاری رسید
        </button>
      </ReceiptPicker>
    </section>
  );
}
