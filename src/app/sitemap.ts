import type { MetadataRoute } from 'next';
import { CategoryDao } from '@/db/dao/CategoryDao';
import { ProductDao } from '@/db/dao/ProductDao';
import { sitemapEntries } from '@/lib/seo';

/**
 * Built per request, like the pages it lists. Next caches `sitemap.ts` by
 * default, which would freeze the catalogue into the build output, and
 * `next build` (a quality gate, and the Docker image build) has no database
 * to reach.
 */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories] = await Promise.all([
    ProductDao.listForSitemap(),
    CategoryDao.list(),
  ]);
  return sitemapEntries(products, categories);
}
