// Which products the home page's «انتخاب‌های اسموکی» grid shows.
//
// Pure and generic over the two fields it reads, so it is testable without a
// database and reusable if the shop page ever wants the same merchandising.
// The DAO decides *which* products exist and in what order; this decides which
// four of them are worth the front page.

/** Four cards, one row on desktop — the grid the design lays out. */
export const FEATURED_COUNT = 4;

type Featurable = {
  stock: number;
  /** Integer Toman, or null when the product is not discounted. */
  oldPrice: number | null;
};

/**
 * The featured selection, in render order.
 *
 * Two rules, both deliberate:
 *   · Out of stock never appears. The card would render as «ناموجود» with a
 *     dead add button, which is the worst thing to lead a shop with — and the
 *     seed catalog has such a product on purpose.
 *   · Discounted products come first, otherwise the caller's order (newest
 *     first, from the DAO) is preserved exactly.
 *
 * Returning fewer than `count` — or nothing at all — is a legitimate answer;
 * the section renders its own copy rather than being handed padding.
 */
export function selectFeatured<T extends Featurable>(
  products: readonly T[],
  count: number = FEATURED_COUNT,
): T[] {
  if (count <= 0) return [];

  const available = products.filter((product) => product.stock > 0);

  return [
    ...available.filter((product) => product.oldPrice !== null),
    ...available.filter((product) => product.oldPrice === null),
  ].slice(0, count);
}
