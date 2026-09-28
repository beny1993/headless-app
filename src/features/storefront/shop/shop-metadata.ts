// What a shop URL tells search engines. A shelf (a category, a pet, or both)
// is a page worth ranking, titled by what it lists. Everything else a shop URL
// can be stays out of the index, its links still followed:
// - a search;
// - a view of a shelf (another sort order, a price range, a page size), which
//   lists other products than the shelf's own page, so a canonical to the
//   shelf would name a page that is not its duplicate (Google's advice for
//   sort and filter variants is `noindex`);
// - a URL that lists nothing (an emptied or unknown category, a page past the
//   end), which Google would otherwise report as a soft 404.
import type { Metadata } from 'next';
import type { Category } from '@/db/schema/catalog';
import { PET_LABELS } from '@/lib/catalog/product-query';
import { absoluteUrl, purchaseSentence } from '@/lib/seo';
import {
  buildShopHref,
  DEFAULT_SHOP_QUERY,
  type ShopQuery,
} from './shop-query';

/** The whole shop's title and heading, and the fallback of every shelf. */
export const SHOP_TITLE = 'فروشگاه';

/** Out of the index, links still followed: what it lists is indexed elsewhere. */
const NOT_INDEXED = { index: false, follow: true };

/**
 * What a shelf lists, as its title and heading name it: the category's title,
 * the pet's products, or both. `undefined` for the whole shop, and for a
 * category slug that names no category.
 */
export function shelfTitle(
  query: ShopQuery,
  categories: Pick<Category, 'slug' | 'title'>[],
): string | undefined {
  const pet = query.pet && PET_LABELS[query.pet];
  if (query.category) {
    const category = categories.find((row) => row.slug === query.category);
    if (!category) return undefined;
    return pet ? `${category.title} ${pet}` : category.title;
  }
  return pet ? `محصولات ${pet}` : undefined;
}

/**
 * `listed` is whether this URL's page of the listing shows any product; the
 * shop page reads the listing anyway and shares it.
 */
export function shopMetadata(
  query: ShopQuery,
  categories: Pick<Category, 'slug' | 'title'>[],
  listed: boolean,
): Metadata {
  const shelf = shelfTitle(query, categories);
  const title = shelf ?? SHOP_TITLE;

  // The shelf this URL shows, with the search and every view parameter reset,
  // written by the shop's own URL builder: the canonical is the very URL the
  // pager and the sitemap link to.
  const shelfHref = buildShopHref({
    ...DEFAULT_SHOP_QUERY,
    category: query.category,
    pet: query.pet,
    page: query.page,
  });
  // No canonical here: a noindexed page whose canonical points elsewhere
  // sends Google two signals that contradict each other.
  if (!listed || buildShopHref(query) !== shelfHref) {
    return { title, robots: NOT_INDEXED };
  }

  return {
    title,
    // The plain shop keeps the site description, which already says it all.
    ...(shelf && { description: purchaseSentence(shelf) }),
    alternates: { canonical: absoluteUrl(shelfHref) },
  };
}
