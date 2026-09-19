import Link from 'next/link';
import type { VariantChip } from '@/db/schema/catalog';
import { productPath } from '@/lib/constant/paths';
import { formatToman } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The smells, colours or sizes this product comes in.
 *
 * Plain links to each member's own page — no client state, no route of its own.
 * A member is a product row with its own slug, so «picking a size» is ordinary
 * navigation, which means it works with the back button, can be shared, and
 * needs no JavaScript at all.
 *
 * Renders nothing when there is no family. The DAO already returns an empty
 * list for a standalone product *and* for one whose only sibling is inactive,
 * because a single chip that is already selected offers no choice.
 *
 * The current member is a `<span>`, not a link to the page it is already on:
 * `aria-current` on a self-link still reads as somewhere to go.
 */
export function VariantChips({
  variants,
  label,
}: {
  variants: VariantChip[];
  /** What the axis is called — «نوع», «اندازه». Names the group for a reader. */
  label: string;
}) {
  if (variants.length === 0) return null;

  return (
    <div className="mb-4">
      <p
        className="text-muted-foreground mb-2 text-sm"
        id="variant-chips-label"
      >
        {label}
      </p>
      <ul
        className="flex flex-wrap gap-2"
        aria-labelledby="variant-chips-label"
      >
        {variants.map((variant) => (
          <li key={variant.id}>
            {variant.isCurrent ? (
              <span
                aria-current="true"
                className="border-primary bg-primary/10 text-foreground inline-flex min-h-11 flex-col items-start justify-center rounded-xl border-2 px-4 py-1 text-sm font-semibold"
              >
                {variant.label}
                <ChipPrice variant={variant} />
              </span>
            ) : (
              <Link
                href={productPath(variant.slug)}
                className={cn(
                  'border-border text-muted-foreground hover:border-primary hover:text-foreground',
                  'inline-flex min-h-11 flex-col items-start justify-center rounded-xl border px-4 py-1 text-sm font-medium transition-colors',
                  !variant.inStock && 'opacity-60',
                )}
                data-umami-event="product-variant-open"
              >
                {variant.label}
                <ChipPrice variant={variant} />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The line under a chip's label: what that size costs, or that it is sold out.
 *
 * Without it the shop's «از ۱۴۹٬۰۰۰ تومان» card led to a page whose heading
 * priced the head at ۱۸۵٬۰۰۰ and offered nothing to explain the difference —
 * the cheapest member was on screen as a chip with no price on it. Every figure
 * goes through `format.ts`, like the rest of the storefront.
 */
function ChipPrice({ variant }: { variant: VariantChip }) {
  return (
    <span className="nums text-muted-foreground text-xs font-normal">
      {variant.inStock ? formatToman(variant.price) : 'ناموجود'}
    </span>
  );
}
