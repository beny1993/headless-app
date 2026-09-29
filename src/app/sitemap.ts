import type { MetadataRoute } from 'next';
import { ProductDao } from '@/db/dao/ProductDao';
import { sitemapEntries } from '@/lib/seo';
import { getEnvFlag, VARS } from '@/lib/utils/env';
import { listStockedShelves } from '@/logic/seo/stocked-shelves';

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

  const [products, shelves] = await Promise.all([
    ProductDao.listForSitemap(),
    listStockedShelves(),
  ]);
  return sitemapEntries(products, shelves);
}
