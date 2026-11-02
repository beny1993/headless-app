// What a shop URL tells search engines. A shelf (a category) is a page
// worth ranking, titled by what it lists. Everything else a shop URL
// can be stays out of the index, its links still followed:
// - a search;
// - a view of a shelf (another sort order, a price range, a page size), which
//   lists other products than the shelf's own page, so a canonical to the
//   shelf would name a page that is not its duplicate (Google's advice for
//   sort and filter variants is `noindex`);
// - a URL that lists nothing (an emptied category, a page past the end), which
//   Google would otherwise report as a soft 404.
// An unknown category is not one of these: the shop page answers it with a
// real 404 (`isUnknownCategory`) and asks for no shop metadata at all.
import type { Metadata } from 'next';
import type { Category } from '@/db/schema/catalog';
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
 * What a shelf lists, as its title and heading name it: the category's title.
 * `undefined` for the whole shop, and for a
 * category slug that names no category.
 */
export function shelfTitle(
  query: ShopQuery,
  categories: Pick<Category, 'slug' | 'title'>[],
): string | undefined {
  if (!query.category) return undefined;
  return categories.find((row) => row.slug === query.category)?.title;
}

/**
 * Whether the URL names a category slug no category has, such as an old link
 * to a renamed or removed one. The shop page answers that with a 404.
 */
export function isUnknownCategory(
  query: ShopQuery,
  categories: Pick<Category, 'slug'>[],
): boolean {
  // Truthy, not defined: the parser can hand over `''`, which every reader of
  // the query treats as no filter at all.
  return (
    Boolean(query.category) &&
    !categories.some(({ slug }) => slug === query.category)
  );
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
  // Indexed or not, the page names its shelf: the tab, and a shared link's
  // preview. The plain shop keeps the site description, which already says it
  // all.
  const named: Metadata = {
    title: shelf ?? SHOP_TITLE,
    ...(shelf && { description: purchaseSentence(shelf) }),
  };

  // The shelf this URL shows, with the search and every view parameter reset,
  // written by the shop's own URL builder: the canonical is the very URL the
  // pager and the sitemap link to.
  const shelfHref = buildShopHref({
    ...DEFAULT_SHOP_QUERY,
    category: query.category,
    page: query.page,
  });
  // No canonical here: a noindexed page whose canonical points elsewhere
  // sends Google two signals that contradict each other.
  if (!listed || buildShopHref(query) !== shelfHref) {
    return { ...named, robots: NOT_INDEXED };
  }

  return { ...named, alternates: { canonical: absoluteUrl(shelfHref) } };
}
