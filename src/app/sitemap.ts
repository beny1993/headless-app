import type { MetadataRoute } from 'next';
import { CategoryDao } from '@/db/dao/CategoryDao';
import { ProductDao } from '@/db/dao/ProductDao';
import { PET_TYPES } from '@/lib/catalog/product-query';
import { shopPath } from '@/lib/constant/paths';
import { sitemapEntries } from '@/lib/seo';
import { getEnvFlag, VARS } from '@/lib/utils/env';

/**
 * Built per request, like the pages it lists. Next caches `sitemap.ts` by
 * default, which would freeze the catalogue into the build output, and
 * `next build` (a quality gate, and the Docker image build) has no database
 * to reach.
 */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Closed: the fixed pages only. The store layout answers every product and
  // shelf URL with the maintenance screen, and a sitemap full of them would
  // hand Google a catalogue of thin pages under product titles.
  if (getEnvFlag(VARS.APP_CONFIG_MAINTENANCE_MODE)) {
    return sitemapEntries([], []);
  }

  const [products, categories] = await Promise.all([
    ProductDao.listForSitemap(),
    CategoryDao.list(),
  ]);
  // A shelf that lists nothing answers with the empty state: noindexed, and a
  // soft 404 to Google if the sitemap names it.
  const stocked = await Promise.all(
    categories.map((category) => ProductDao.hasShelfProducts(category.slug)),
  );
  return sitemapEntries(products, [
    ...Object.values(PET_TYPES).map((pet) => shopPath({ pet })),
    ...categories
      .filter((_, index) => stocked[index])
      .map((category) => shopPath({ category: category.slug })),
  ]);
}
