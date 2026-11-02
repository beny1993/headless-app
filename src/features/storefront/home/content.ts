// The home page's non-editable, code-side data — the parts that are NOT content.
//
// What stays here is destination-bearing: the code-side fallbacks a section uses
// while no destination is saved. Kept in one module so the check that matters
// runs without a browser: every built-in deep link names a category that really
// exists (the design review's "no dead navigation" rule).
import { shopPath, type ShopFilters } from '@/lib/constant/paths';

/**
 * A code-side shelf link, kept to categories the catalogue has: a slug it does
 * not know is dropped for the whole shop, as `resolveLink` does for a saved link
 * to a deleted category. The built-in slugs (the featured story's button) are
 * the seed's, and the shop answers a category it does not know with a 404.
 */
export function knownShelfPath(
  filters: ShopFilters,
  categorySlugs: readonly string[],
): string {
  const known =
    filters.category !== undefined && categorySlugs.includes(filters.category);
  return shopPath(known ? filters : {});
}
