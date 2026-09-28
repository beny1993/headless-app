// What a shop URL tells search engines. A shelf (a category, a pet, or both)
// is a page worth ranking, so it is titled by what it lists; a sort order or a
// price range is a view of that same shelf, so the canonical leaves it out. A
// search, and a category that does not exist, stay out of the index.
import type { Metadata } from 'next';
import { DEFAULT_SITE_NAME } from '@/constants';
import type { Category } from '@/db/schema/catalog';
import { PET_LABELS } from '@/lib/catalog/product-query';
import { PATHS } from '@/lib/constant/paths';
import { absoluteUrl } from '@/lib/seo';
import type { ShopQuery } from './shop-query';

const SHOP_TITLE = 'فروشگاه';

/** Out of the index, links still followed: what it lists is indexed elsewhere. */
const NOT_INDEXED = { index: false, follow: true };

export function shopMetadata(
  query: ShopQuery,
  categories: Pick<Category, 'slug' | 'title'>[],
): Metadata {
  const category =
    query.category && categories.find((row) => row.slug === query.category);
  // No canonical here: a noindexed page whose canonical points elsewhere
  // sends Google two signals that contradict each other.
  if (query.q || (query.category && !category)) {
    return { title: SHOP_TITLE, robots: NOT_INDEXED };
  }

  const pet = query.pet && PET_LABELS[query.pet];
  const title = category
    ? [category.title, pet].filter(Boolean).join(' ')
    : pet
      ? `محصولات ${pet}`
      : SHOP_TITLE;

  // The shelf's own parameters only, in one fixed order, so every URL for a
  // shelf names the same canonical; page one is the shelf itself.
  const params = new URLSearchParams();
  if (query.category) params.set('category', query.category);
  if (query.pet) params.set('pet', query.pet);
  if (query.page > 1) params.set('page', String(query.page));
  const search = params.toString();

  return {
    title,
    // The plain shop keeps the site description, which already says it all.
    ...(title !== SHOP_TITLE && {
      description: `خرید ${title} از ${DEFAULT_SITE_NAME}، فروشگاه آنلاین حیوانات خانگی.`,
    }),
    alternates: {
      canonical: absoluteUrl(search ? `${PATHS.SHOP}?${search}` : PATHS.SHOP),
    },
  };
}
