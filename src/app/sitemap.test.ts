// The sitemap route's own decisions: what it hands crawlers while the shop is
// open, and what it holds back while the maintenance gate hides the store. Its
// reads are mocked at the module edge — which shelves list something is
// `listStockedShelves`'s to decide, pinned in its own suite.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATHS, productPath, shopPath } from '@/lib/constant/paths';
import { absoluteUrl } from '@/lib/seo';

const read = vi.hoisted(() => ({
  listForSitemap: vi.fn(),
  listStockedShelves: vi.fn(),
}));
vi.mock('@/db/dao/ProductDao', () => ({
  ProductDao: { listForSitemap: read.listForSitemap },
}));
vi.mock('@/logic/seo/stocked-shelves', () => ({
  listStockedShelves: read.listStockedShelves,
}));

const { default: sitemap } = await import('./sitemap');

const urlsOf = async () => (await sitemap()).map((entry) => entry.url);

describe('sitemap.xml', () => {
  beforeEach(() => {
    read.listForSitemap.mockResolvedValue([
      { slug: 'royal-canin', updatedAt: new Date('2026-09-20T10:00:00Z') },
    ]);
    read.listStockedShelves.mockResolvedValue([
      shopPath({ category: 'kitchen' }),
      shopPath({ category: 'stationery' }),
    ]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('lists every product page and every stocked shelf while the shop is open', async () => {
    vi.stubEnv('APP_CONFIG_MAINTENANCE_MODE', '');
    const urls = await urlsOf();

    expect(urls).toContain(absoluteUrl(productPath('royal-canin')));
    expect(urls).toContain(absoluteUrl(shopPath({ category: 'kitchen' })));
    expect(urls).toContain(absoluteUrl(shopPath({ category: 'stationery' })));
    // Nothing the shelf check left out comes back some other way.
    expect(urls).not.toContain(absoluteUrl(shopPath({ category: 'audio' })));
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
    expect(read.listForSitemap).not.toHaveBeenCalled();
    expect(read.listStockedShelves).not.toHaveBeenCalled();
  });
});
