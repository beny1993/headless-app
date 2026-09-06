import { ShoppingBag } from 'lucide-react';
import { formatToman, toPersianDigits } from '@/lib/format';

/**
 * One line in the summary. `lineTotal` is integer Toman (qty × unit price) —
 * `bigint` from the client cart, `number` from a server order; both format
 * exactly through `formatToman`. `imageKey` is a storage key
 * (`products/cat-toy.jpg` → `/products/cat-toy.jpg`), present on the client cart
 * and absent on a server order (order items snapshot no image — no join back to
 * `products`), so it degrades to a placeholder.
 */
export type SummaryLine = {
  id: string;
  title: string;
  qty: number;
  lineTotal: bigint | number;
  imageKey?: string;
};

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
      <ul className="mb-4 space-y-3">
        {lines.map((line) => (
          <li key={line.id} className="flex items-center gap-3">
            {line.imageKey ? (
              // `alt=""`: the title is announced right after, so a described
              // thumbnail would only repeat it.
              <img
                src={`/${line.imageKey}`}
                alt=""
                width={48}
                height={48}
                className="bg-muted size-12 rounded-lg object-cover"
              />
            ) : (
              <div className="bg-muted flex size-12 items-center justify-center rounded-lg">
                <ShoppingBag
                  size={18}
                  className="text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-xs font-medium">{line.title}</p>
              <p className="nums text-muted-foreground text-xs">
                ×{toPersianDigits(line.qty)}
              </p>
            </div>
            <p className="nums shrink-0 text-xs font-bold">
              {formatToman(line.lineTotal)}
            </p>
          </li>
        ))}
      </ul>

      <dl className="border-border space-y-2 border-t pt-4">
        <div className="flex justify-between text-sm">
          <dd className="nums">{formatToman(subtotal)}</dd>
          <dt className="text-muted-foreground">جمع اقلام</dt>
        </div>
        {hasDiscount && (
          <div className="flex justify-between text-sm">
            <dd className="nums text-success-strong">
              −{formatToman(discount ?? 0)}
            </dd>
            <dt className="text-muted-foreground">تخفیف</dt>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <dd
            className={shippingFee === null ? 'text-muted-foreground' : 'nums'}
          >
            {shippingFee === null
              ? 'بعد از انتخاب استان'
              : formatToman(shippingFee)}
          </dd>
          <dt className="text-muted-foreground">ارسال</dt>
        </div>
        <div className="border-border mt-2 flex justify-between border-t pt-2 font-bold">
          <dd className="nums">{formatToman(total)}</dd>
          <dt>جمع کل</dt>
        </div>
      </dl>
    </>
  );
}
