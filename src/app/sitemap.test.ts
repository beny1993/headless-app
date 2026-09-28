// The sitemap route's own decisions: what it hands crawlers while the shop is
// open, and what it holds back while the maintenance gate hides the store. The
// DAOs are mocked at the module edge; the route's choices run for real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PET_TYPES } from '@/lib/catalog/product-query';
import { PATHS, productPath, shopPath } from '@/lib/constant/paths';
import { absoluteUrl } from '@/lib/seo';

const dao = vi.hoisted(() => ({
  listForSitemap: vi.fn(),
  hasShelfProducts: vi.fn(),
  listCategories: vi.fn(),
}));
vi.mock('@/db/dao/ProductDao', () => ({
  ProductDao: {
    listForSitemap: dao.listForSitemap,
    hasShelfProducts: dao.hasShelfProducts,
  },
}));
vi.mock('@/db/dao/CategoryDao', () => ({
  CategoryDao: { list: dao.listCategories },
}));

const { default: sitemap } = await import('./sitemap');

const urlsOf = async () => (await sitemap()).map((entry) => entry.url);

describe('sitemap.xml', () => {
  beforeEach(() => {
    dao.listForSitemap.mockResolvedValue([
      { slug: 'royal-canin', updatedAt: new Date('2026-09-20T10:00:00Z') },
    ]);
    dao.listCategories.mockResolvedValue([
      { slug: 'dry-food' },
      { slug: 'emptied' },
    ]);
    dao.hasShelfProducts.mockImplementation(
      async (slug: string) => slug !== 'emptied',
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('lists the catalogue while the shop is open, and only shelves that list something', async () => {
    vi.stubEnv('APP_CONFIG_MAINTENANCE_MODE', '');
    const urls = await urlsOf();

    expect(urls).toContain(absoluteUrl(productPath('royal-canin')));
    expect(urls).toContain(absoluteUrl(shopPath({ category: 'dry-food' })));
    for (const pet of Object.values(PET_TYPES)) {
      expect(urls).toContain(absoluteUrl(shopPath({ pet })));
    }
    // Its page answers with an empty state: a soft 404 to Google.
    expect(urls).not.toContain(absoluteUrl(shopPath({ category: 'emptied' })));
  });

  it('holds the catalogue back while the shop is closed', async () => {
    vi.stubEnv('APP_CONFIG_MAINTENANCE_MODE', 'true');

    // What it listed before the catalogue was ever in it: every store page
    // answers with the maintenance screen, product and shelf pages included.
    expect(await urlsOf()).toEqual([
      absoluteUrl(PATHS.HOME),
      absoluteUrl(PATHS.SHOP),
      absoluteUrl(PATHS.ABOUT),
    ]);
    expect(dao.listForSitemap).not.toHaveBeenCalled();
    expect(dao.hasShelfProducts).not.toHaveBeenCalled();
  });
});
