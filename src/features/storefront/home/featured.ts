// Which products the home page's «انتخاب‌های اسموکی» grid shows.
//
// Pure and generic over the fields it reads, so it is testable without a
// database and reusable if the shop page ever wants the same merchandising.
// The admin may pick a product for each box (`home.recommends.productIds`); the
// DAO decides *which* products exist and in what order; this decides which four
// of them are worth the front page, and where each one sits.

/**
 * Four cards, one row on desktop — the grid the design lays out, and so the
 * number of boxes the content schema lets the admin pick for.
 */
export const FEATURED_COUNT = 4;

type Featurable = {
  id: string;
  /** Whether any of the family is on the shelf — what the card greys out on. */
  familyInStock: boolean;
  /** Integer Toman, or null when the product is not discounted. */
  oldPrice: number | null;
};

/**
 * The featured selection, in render order: one product per box.
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
 *   · The automatic boxes lead with discounted products; otherwise the caller's
 *     order (newest first, from the DAO) is preserved exactly.
 *
 * Returning fewer than `count` — or nothing at all — is a legitimate answer;
 * the section renders its own copy rather than being handed padding.
 */
export function selectFeatured<T extends Featurable>(
  products: readonly T[],
  picks: readonly (T | undefined)[] = [],
  count: number = FEATURED_COUNT,
): T[] {
  if (count <= 0) return [];

  const boxes = Array.from({ length: count }, (_, i) =>
    picks[i]?.familyInStock ? picks[i] : undefined,
  );
  const shown = new Set(boxes.map((pick) => pick?.id));
  const available = products.filter(
    (product) => product.familyInStock && !shown.has(product.id),
  );
  const automatic = [
    ...available.filter((product) => product.oldPrice !== null),
    ...available.filter((product) => product.oldPrice === null),
  ];

  return boxes
    .map((pick) => pick ?? automatic.shift())
    .filter((product): product is T => product !== undefined);
}
