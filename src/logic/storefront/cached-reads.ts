// The storefront's cached reads: data only an admin changes, read through the
// same DAOs as before but kept in memory (`src/lib/cache/store.ts`) until an
// admin write drops its tag. `Story - Storefront Caching and Streaming`.
//
// Storefront call sites only. The admin panel keeps reading the DAOs directly,
// so an edit made outside the admin API (`pnpm seed-catalog`, psql) is visible
// to the admin at once, and only the storefront waits out the expiry below.
//
// Never cached here: anything showing stock or price (a product, a listing, the
// home page's featured products), and anything tied to a session.
import { CategoryDao } from '@/db/dao/CategoryDao';
import { ProductDao } from '@/db/dao/ProductDao';
import { ShippingRateDao } from '@/db/dao/ShippingRateDao';
import { SiteContentDao } from '@/db/dao/SiteContentDao';
import { CACHE_TAGS, cached } from '@/lib/cache/store';
import { CONTENT_KEYS } from '@/lib/content/site-content';
import { listStockedShelves } from '@/logic/seo/stocked-shelves';

const { SITE_CONTENT, CATEGORIES, PRODUCTS, SHIPPING } = CACHE_TAGS;

/**
 * How long a value lives with no admin write to drop it: the bound on how stale
 * the storefront can be after a write that bypassed the admin API (a seed, a
 * migration, psql).
 */
export const CACHE_TTL_MS = 10 * 60_000;

/**
 * The sitemap's lists also depend on stock — a shelf drops out when it sells
 * out — and an order's stock change clears nothing, so this is how long a
 * sold-out shelf can stay listed. Crawlers do not mind an hour.
 */
export const SITEMAP_TTL_MS = 60 * 60_000;

/**
 * Every content block, resolved to its default where a row is missing or
 * invalid. One read for all of them: the header/footer and the page's own
 * area come from the same entry, as `chrome.ts`' old ponytail asked.
 */
export const storefrontContent = () =>
  cached('site-content', { tags: [SITE_CONTENT], ttlMs: CACHE_TTL_MS }, () =>
    SiteContentDao.getMany(CONTENT_KEYS),
  );

/** Every category, tree fields included — the shop, product and home pages. */
export const storefrontCategories = () =>
  cached('categories', { tags: [CATEGORIES], ttlMs: CACHE_TTL_MS }, () =>
    CategoryDao.list(),
  );

/**
 * The active provinces and their fees, for the product page's structured data
 * and the account's address form. Checkout reads them live: the fee it charges
 * is the one in the database at that moment.
 */
export const storefrontShippingRates = () =>
  cached('shipping-rates', { tags: [SHIPPING], ttlMs: CACHE_TTL_MS }, () =>
    ShippingRateDao.listActive(),
  );

/** The shop's price-slider ends: active products' prices, never stock. */
export const storefrontPriceBounds = () =>
  cached('price-bounds', { tags: [PRODUCTS], ttlMs: CACHE_TTL_MS }, () =>
    ProductDao.priceBounds(),
  );

/** What `sitemap.xml` lists: active products, and the shelves with stock. */
export const sitemapLists = () =>
  cached(
    'sitemap',
    { tags: [PRODUCTS, CATEGORIES], ttlMs: SITEMAP_TTL_MS },
    async () => {
      const [products, shelves] = await Promise.all([
        ProductDao.listForSitemap(),
        listStockedShelves(),
      ]);
      return { products, shelves };
    },
  );
