import { apiOrderReceiptPath } from '@/lib/constant/paths';
import type { OrderStatus } from '@/lib/orders/order-status';
import {
  OPENS_IN_NEW_TAB,
  receiptAlt,
  receiptsLabel,
} from '@/lib/orders/receipt';

/**
 * The card-to-card receipt box, on the checkout result page and the account
 * order page: the receipts the order holds, as thumbnails through the owner's
 * authenticated route — never a public URL and never `next/image`. Nothing to
 * upload: the checkout's screenshot is the one way a receipt arrives, and an
 * order whose screenshot never did is sorted out through support. The pages
 * render it only when there is a receipt to show. The pill says where the
 * receipt stands; what happens next is the page's own copy to say.
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
  return (
    <section className="bg-card border-border mb-7 rounded-2xl border p-5 text-start">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">رسید پرداخت</h2>
        <span className="bg-secondary rounded-full px-2.5 py-1 text-xs font-medium">
          {receiptsLabel(orderStatus)}
        </span>
      </div>

      <ul className="flex flex-wrap gap-3">
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
    </section>
  );
}
