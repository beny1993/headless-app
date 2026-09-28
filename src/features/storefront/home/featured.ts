// Which products the home page's «انتخاب‌های اسموکی» grid shows.
//
// Pure and generic over the fields it reads, so it is testable without a
// database and reusable if the shop page ever wants the same merchandising.
// The admin may pick a product for each box (`home.recommends.productIds`); the
// DAO decides *which* products exist and in what order; this decides which of
// them are worth the front page, and where each one sits.
import { FEATURED_COUNT } from '@/lib/content/site-content';

type Featurable = {
  id: string;
  /** This row's own stock — a family's head is one size among several. */
  stock: number;
  /** Whether any of the family is on the shelf — what the card greys out on. */
  familyInStock: boolean;
  /** Integer Toman, or null when the product is not discounted. */
  oldPrice: number | null;
};

/**
 * A discount a shopper can actually buy: the discounted row itself is in
 * stock. A family whose discounted head is sold out still features through its
 * other sizes, but it is no deal and does not jump the queue as one.
 */
const isDeal = (product: Featurable) =>
  product.oldPrice !== null && product.stock > 0;

/**
 * The featured selection, in render order: one product per box, FEATURED_COUNT
 * boxes.
 *
 * `picks` are the admin's, box by box — `undefined` where a box is left on
 * «خودکار», or its pick is no longer listed. A pick shows in its own box; every
 * other box takes the next product the automatic rule offers, and no product
 * shows twice.
 *
 * The rules, all deliberate:
 *   · Out of stock never appears — a sold-out pick included: its box is filled
 *     instead. The card would render as «ناموجود» with a dead add button, which
 *     is the worst thing to lead a shop with — and the seed catalog has such a
 *     product on purpose. Read off the family, exactly as the card reads it: a
 *     sold-out head must not hide an in-stock 10kg.
 *   · The automatic boxes lead with the deals (`isDeal`); otherwise the
 *     caller's order (newest first, from the DAO) is preserved exactly.
 *
 * Returning fewer than FEATURED_COUNT — or nothing at all — is a legitimate
 * answer; the section renders its own copy rather than being handed padding.
 */
export function selectFeatured<T extends Featurable>(
  products: readonly T[],
  picks: readonly (T | undefined)[] = [],
): T[] {
  const boxes = Array.from({ length: FEATURED_COUNT }, (_, i) =>
    picks[i]?.familyInStock ? picks[i] : undefined,
  );
  const shown = new Set(boxes.map((pick) => pick?.id));
  const available = products.filter(
    (product) => product.familyInStock && !shown.has(product.id),
  );
  const automatic = [
    ...available.filter(isDeal),
    ...available.filter((product) => !isDeal(product)),
  ];

  return boxes
    .map((pick) => pick ?? automatic.shift())
    .filter((product): product is T => product !== undefined);
}
