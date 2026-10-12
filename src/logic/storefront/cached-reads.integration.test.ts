// The storefront read cache against the real Hono app and the dev database:
// a cached read is served from memory, and every admin write path drops the
// reads that depend on it — so what `invalidateOnWrite`'s mounts in
// `src/lib/hono/index.ts` promise is proven at the request level. Only the
// session lookup is mocked. `Story - Storefront Caching and Streaming`.
import { faker } from '@faker-js/faker';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categories } from '@/db/schema/catalog';
import { siteContent } from '@/db/schema/site-content';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import {
  API_PATHS,
  apiAdminCategoryPath,
  apiAdminContentPath,
  apiAdminProductPath,
  apiAdminProvincePath,
  apiShippingRatePath,
} from '@/lib/constant/paths';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ isAuthenticatedUser: mocks.getSession }));

const { app } = await importWithDb(() => import('@/lib/hono'));
const { CategoryDao } = await importWithDb(
  () => import('@/db/dao/CategoryDao'),
);
const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));
const { ShippingRateDao } = await importWithDb(
  () => import('@/db/dao/ShippingRateDao'),
);
const { SiteContentDao } = await importWithDb(
  () => import('@/db/dao/SiteContentDao'),
);
const reads = await importWithDb(() => import('./cached-reads'));

const asAdmin = () =>
  mocks.getSession.mockResolvedValue({
    user: { id: 'admin-1', email: 'a@example.com', role: 'admin' },
    session: { id: 's1' },
  });
const asCustomer = () =>
  mocks.getSession.mockResolvedValue({
    user: { id: 'cust-1', email: 'c@example.com', role: 'customer' },
    session: { id: 's2' },
  });
const anon = () => mocks.getSession.mockResolvedValue(null);

const send = (path: string, method: string, body?: unknown) =>
  app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }),
  });

describe.skipIf(!databaseReachable)('storefront cached reads', () => {
  afterEach(() => {
    mocks.getSession.mockReset();
    vi.restoreAllMocks();
  });

  describe('serve from memory', () => {
    it('reads each source once for repeated reads', async () => {
      const list = vi.spyOn(CategoryDao, 'list');
      const rates = vi.spyOn(ShippingRateDao, 'listActive');
      const bounds = vi.spyOn(ProductDao, 'priceBounds');
      const content = vi.spyOn(SiteContentDao, 'getMany');
      const sitemap = vi.spyOn(ProductDao, 'listForSitemap');

      for (let round = 0; round < 3; round++) {
        await Promise.all([
          reads.storefrontCategories(),
          reads.storefrontShippingRates(),
          reads.storefrontPriceBounds(),
          reads.storefrontContent(),
          reads.sitemapLists(),
        ]);
      }

      expect(list).toHaveBeenCalledTimes(2); // the categories + the sitemap's shelves
      expect(rates).toHaveBeenCalledTimes(1);
      expect(bounds).toHaveBeenCalledTimes(1);
      expect(content).toHaveBeenCalledTimes(1);
      expect(sitemap).toHaveBeenCalledTimes(1);
    });

    it('hands back rows as the DAO built them, Dates intact', async () => {
      const [row] = await reads.storefrontCategories();
      expect(row?.createdAt).toBeInstanceOf(Date);
      const { products } = await reads.sitemapLists();
      expect(products[0]?.updatedAt).toBeInstanceOf(Date);
    });

    it('resolves every content key, defaults included', async () => {
      const content = await reads.storefrontContent();
      expect(Object.keys(content).sort()).toEqual(
        Object.keys(DEFAULT_CONTENT).sort(),
      );
    });
  });

  describe('an admin save shows on the very next read', () => {
    const KEY = 'home.hero';
    let saved: { value: unknown } | undefined;
    beforeEach(async () => {
      [saved] = await testDb
        .select({ value: siteContent.value })
        .from(siteContent)
        .where(eq(siteContent.key, KEY));
    });
    afterEach(async () => {
      await testDb.delete(siteContent).where(eq(siteContent.key, KEY));
      if (saved) {
        await testDb
          .insert(siteContent)
          .values({ key: KEY, value: saved.value });
      }
    });

    it('content', async () => {
      await reads.storefrontContent();
      const headline = `تیتر ${faker.string.alphanumeric(8)}`;

      asAdmin();
      const res = await send(apiAdminContentPath(KEY), 'PUT', {
        ...DEFAULT_CONTENT[KEY],
        headline,
      });

      expect(res.status).toBe(200);
      expect((await reads.storefrontContent())[KEY].headline).toBe(headline);
    });

    it('categories: a create, a rename and a delete', async () => {
      await reads.storefrontCategories();
      const slug = `cache-${faker.string.alphanumeric(10).toLowerCase()}`;
      const slugs = async () =>
        (await reads.storefrontCategories()).map((row) => row.slug);

      asAdmin();
      const created = await send(API_PATHS.ADMIN_CATEGORIES, 'POST', {
        title: 'دسته کش',
        slug,
        sortOrder: 0,
      });
      const { data } = (await created.json()) as { data: { id: string } };
      try {
        expect(created.status).toBe(201);
        expect(await slugs()).toContain(slug);

        const renamed = await send(apiAdminCategoryPath(data.id), 'PUT', {
          title: 'دسته کش',
          slug: `${slug}-2`,
          sortOrder: 0,
        });
        expect(renamed.status).toBe(200);
        expect(await slugs()).toContain(`${slug}-2`);

        const removed = await send(apiAdminCategoryPath(data.id), 'DELETE');
        expect(removed.status).toBe(200);
        expect(await slugs()).not.toContain(`${slug}-2`);
      } finally {
        await testDb
          .delete(categories)
          .where(inArray(categories.slug, [slug, `${slug}-2`]));
      }
    });
  });

  // The middleware drops on any write its guard let through, so a refused
  // body is enough to prove a path is covered without touching shared rows.
  describe('every admin write path drops its reads', () => {
    const counts = () => ({
      bounds: vi.spyOn(ProductDao, 'priceBounds'),
      sitemap: vi.spyOn(ProductDao, 'listForSitemap'),
      rates: vi.spyOn(ShippingRateDao, 'listActive'),
      content: vi.spyOn(SiteContentDao, 'getMany'),
    });
    const readAll = () =>
      Promise.all([
        reads.storefrontPriceBounds(),
        reads.sitemapLists(),
        reads.storefrontShippingRates(),
        reads.storefrontContent(),
      ]);

    const id = '00000000-0000-4000-8000-000000000000';
    it.each([
      [
        'a product create',
        API_PATHS.ADMIN_PRODUCTS,
        'POST',
        ['bounds', 'sitemap'],
      ],
      ['a product edit', apiAdminProductPath(id), 'PUT', ['bounds', 'sitemap']],
      [
        'a product removal',
        apiAdminProductPath(id),
        'DELETE',
        ['bounds', 'sitemap'],
      ],
      ['a fee change', apiShippingRatePath(1), 'PUT', ['rates']],
      ['a province switch', apiAdminProvincePath(1), 'PATCH', ['rates']],
      ['one fee for all', API_PATHS.ADMIN_PROVINCES_FEE, 'PUT', ['rates']],
      ['a content save', apiAdminContentPath('home.hero'), 'PUT', ['content']],
      ['a category save', apiAdminCategoryPath(id), 'PUT', ['sitemap']],
    ] as const)('%s', async (_name, path, method, dropped) => {
      const spies = counts();
      await readAll();

      asAdmin();
      await send(path, method, { not: 'a valid body' });
      await readAll();

      for (const [name, spy] of Object.entries(spies)) {
        expect
          .soft(spy, name)
          .toHaveBeenCalledTimes(
            (dropped as readonly string[]).includes(name) ? 2 : 1,
          );
      }
    });

    it.each([
      ['an anonymous caller', anon, 401],
      ['a customer', asCustomer, 403],
    ] as const)(
      'is not reachable by %s, who cannot empty the cache',
      async (_name, as, status) => {
        const spies = counts();
        await readAll();

        as();
        const res = await send(apiAdminContentPath('home.hero'), 'PUT', {});
        await send(apiShippingRatePath(1), 'PUT', { fee: 1 });
        await readAll();

        expect(res.status).toBe(status);
        for (const spy of Object.values(spies)) {
          expect(spy).toHaveBeenCalledTimes(1);
        }
      },
    );

    it('is not dropped by a storefront read of the same data', async () => {
      const spies = counts();
      await readAll();

      anon();
      await send(API_PATHS.CATEGORIES, 'GET');
      await send(API_PATHS.PRODUCTS, 'GET');
      await readAll();

      for (const spy of Object.values(spies)) {
        expect(spy).toHaveBeenCalledTimes(1);
      }
    });
  });
});
