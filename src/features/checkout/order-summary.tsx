import Image from 'next/image';
import { ShoppingBag } from 'lucide-react';
import { formatToman, toPersianDigits } from '@/lib/format';
import { imageSrc } from '@/lib/storage/image-url';

/**
 * One line in the summary. `lineTotal` is integer Toman (qty × unit price) —
 * `bigint` from the client cart, `number` from a server order; both format
 * exactly through `formatToman`. `imageKey` is a storage key
 * (`products/cat-toy.jpg` → `/products/cat-toy.jpg`): the cart's own, or on a
 * server order its product's current first photo (`getOwnedOrder`); a line
 * without one degrades to a placeholder.
 */
export type SummaryLine = {
  id: string;
  title: string;
  qty: number;
  lineTotal: bigint | number;
  imageKey?: string;
};

/** A server order's item snapshots as summary lines: unit price × quantity. */
export const toSummaryLines = (
  items: readonly {
    id: string;
    title: string;
    qty: number;
    unitPrice: number;
    imageKey?: string;
  }[],
): SummaryLine[] =>
  items.map((item) => ({
    id: item.id,
    title: item.title,
    qty: item.qty,
    lineTotal: item.unitPrice * item.qty,
    ...(item.imageKey ? { imageKey: item.imageKey } : {}),
  }));

/**
 * The order-summary CORE — the line items and the subtotal / shipping / total
 * rows, with no card chrome of its own so both callers can wrap it: `/checkout`
 * in its sidebar card (with the "server re-prices" note) fed the localStorage
 * cart and a per-province fee estimate, and the result page inside the order
 * detail box fed the server order's authoritative snapshots. Money is integer
 * Toman throughout and formatted only here.
 */
export function OrderSummary({
  lines,
  subtotal,
  discount = null,
  shippingFee,
  total,
}: {
  lines: SummaryLine[];
  subtotal: bigint | number;
  /**
   * The applied discount (integer Toman), or `null`/0 when none. Shown as a
   * «تخفیف» row above the total when positive — both `/checkout` (from the
   * server preview) and the order-detail pages (from `order.discount`) pass it.
   */
  discount?: bigint | number | null;
  /** `null` on `/checkout` before a province is chosen. */
  shippingFee: bigint | number | null;
  total: bigint | number;
}) {
  const hasDiscount =
    discount != null &&
    (typeof discount === 'bigint' ? discount > 0n : discount > 0);
  return (
    <>
      <ul className="mb-4 space-y-3 lg:space-y-4">
        {lines.map((line) => (
          <li key={line.id} className="flex items-center gap-3">
            {line.imageKey ? (
              // `alt=""`: the title is announced right after, so a described
              // thumbnail would only repeat it.
              <Image
                src={imageSrc(line.imageKey)}
                alt=""
                width={96}
                height={96}
                className="bg-muted size-16 rounded-lg object-cover lg:size-24"
              />
            ) : (
              <div className="bg-muted flex size-16 items-center justify-center rounded-lg lg:size-24">
                <ShoppingBag
                  size={20}
                  className="text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
            )}
            {/* Price and quantity sit UNDER the title, not beside it: the
                checkout sidebar column is ~216px inside its padding, and a
                price on the same row left the title about 60px — two clamped
                half-words. Stacked, the title gets the whole text column. */}
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-medium lg:text-base">
                {line.title}
              </p>
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
                {/* `shrink-0` on both: a price's only break opportunity is the
                    space before «تومان», and letting it take one orphans the
                    currency word under the amount. When the row genuinely does
                    not fit (a nine-digit total in the 138px checkout sidebar)
                    `flex-wrap` drops the quantity to its own line instead of
                    pushing past the card. */}
                <p className="nums shrink-0 text-sm font-bold lg:text-base">
                  {formatToman(line.lineTotal)}
                </p>
                <p className="nums text-muted-foreground shrink-0 text-sm">
                  ×{toPersianDigits(line.qty)}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Label at the start (right), amount at the end: the Persian
          receipt order (Benyamin, 2026-09-15). The desktop size sits on the
          list so every row inherits it; the total row steps up once more. */}
      <dl className="border-border space-y-2 border-t pt-4 text-sm lg:text-base">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">جمع اقلام</dt>
          <dd className="nums">{formatToman(subtotal)}</dd>
        </div>
        {hasDiscount && (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">تخفیف</dt>
            <dd className="nums text-success-strong">
              −{formatToman(discount ?? 0)}
            </dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-muted-foreground">ارسال</dt>
          <dd
            className={shippingFee === null ? 'text-muted-foreground' : 'nums'}
          >
            {shippingFee === null
              ? 'بعد از انتخاب استان'
              : formatToman(shippingFee)}
          </dd>
        </div>
        <div className="border-border mt-2 flex justify-between border-t pt-2 text-base font-bold lg:text-lg">
          <dt>جمع کل</dt>
          <dd className="nums">{formatToman(total)}</dd>
        </div>
      </dl>
    </>
  );
}
