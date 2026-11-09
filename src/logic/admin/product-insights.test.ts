import { describe, expect, it, vi } from 'vitest';
import type { ProductSalesRow } from '@/db/dao/OrderDao';
import type { ProductInsightRow } from '@/db/dao/ProductDao';
import type { UmamiResult } from '@/lib/umami/client';

// The builder is pure; the DAOs and the Umami client are only `loadProductInsights`'s.
vi.mock('@/db/dao/OrderDao', () => ({
  OrderDao: { salesByProductSince: vi.fn() },
}));
vi.mock('@/db/dao/ProductDao', () => ({
  ProductDao: { insightRows: vi.fn() },
}));
vi.mock('@/lib/umami/client', () => ({ readUmamiMetric: vi.fn() }));

const { OrderDao } = await import('@/db/dao/OrderDao');
const { ProductDao } = await import('@/db/dao/ProductDao');
const { readUmamiMetric } = await import('@/lib/umami/client');

const {
  ACTION_LIST_SIZE,
  PRODUCT_TABLE_SIZE,
  SOURCE_LIST_SIZE,
  buildProductInsights,
  loadProductInsights,
  productSlugOfPath,
  sourceLabel,
} = await import('./product-insights');

const product = (
  slug: string,
  over: Partial<ProductInsightRow> = {},
): ProductInsightRow => ({
  id: `id-${slug}`,
  slug,
  title: `محصول ${slug}`,
  variantOf: null,
  variantLabel: null,
  stock: 10,
  isActive: true,
  categoryId: 'cat-food',
  categoryTitle: 'غذای خشک',
  parentCategoryTitle: 'غذا',
  ...over,
});

const sale = (
  slug: string,
  units: number,
  revenue: number,
  orders = units,
): ProductSalesRow => ({ productId: `id-${slug}`, units, revenue, orders });

const views = (rows: Record<string, number>): UmamiResult => ({
  status: 'ok',
  rows: Object.entries(rows).map(([key, count]) => ({ key, count })),
});

const OFF: UmamiResult = { status: 'off' };
const NO_SOURCES: UmamiResult = { status: 'ok', rows: [] };

const build = ({
  sales = [],
  products = [],
  pageViews = OFF,
  referrers = OFF,
}: {
  sales?: ProductSalesRow[];
  products?: ProductInsightRow[];
  pageViews?: UmamiResult;
  referrers?: UmamiResult;
}) => buildProductInsights({ sales, products, pageViews, referrers });

describe('productSlugOfPath', () => {
  it.each([
    ['/product/cat-food', 'cat-food'],
    ['/product/cat-food/', 'cat-food'],
    ['/product/cat-food?ref=ig', 'cat-food'],
    ['/product/cat-food#reviews', 'cat-food'],
    ['/product/%D8%BA%D8%B0%D8%A7', 'غذا'],
  ])('reads %s as %s', (path, slug) => {
    expect(productSlugOfPath(path)).toBe(slug);
  });

  it.each([
    ['the home page', '/'],
    ['the shop', '/shop?category=kitchen'],
    ['the bare prefix', '/product/'],
    ['the prefix without a slash', '/product'],
    ['a deeper path', '/product/a/b'],
    ['a look-alike prefix', '/products/a'],
    ['an admin path', '/admin-panel/products/a'],
    ['broken percent-encoding', '/product/%E0%A4%A'],
  ])('is not a product page: %s', (_label, path) => {
    expect(productSlugOfPath(path)).toBeNull();
  });
});

describe('sourceLabel', () => {
  it.each([
    ['instagram.com', 'اینستاگرام'],
    ['l.instagram.com', 'اینستاگرام'],
    ['www.instagram.com', 'اینستاگرام'],
    ['google.com', 'گوگل'],
    ['www.google.co.uk', 'گوگل'],
    ['t.me', 'تلگرام'],
    ['web.telegram.org', 'تلگرام'],
    ['www.bing.com', 'بینگ'],
    ['WWW.Example.COM', 'example.com'],
  ])('%s → %s', (domain, label) => {
    expect(sourceLabel(domain)).toBe(label);
  });

  it('does not fold a look-alike into a family', () => {
    expect(sourceLabel('notinstagram.com')).toBe('notinstagram.com');
    expect(sourceLabel('google.evil.com')).toBe('google.evil.com');
  });
});

describe('buildProductInsights', () => {
  describe('without Umami', () => {
    it('reports sales alone, every view null, and no action lists', () => {
      const report = build({
        sales: [sale('a', 3, 300_000)],
        products: [product('a', { stock: 0 })],
      });
      expect(report.viewsStatus).toBe('off');
      expect(report.totals).toEqual({
        units: 3,
        revenue: 300_000,
        orders: 3,
        views: null,
      });
      expect(report.products[0]).toMatchObject({ units: 3, views: null });
      expect(report.categories[0]!.views).toBeNull();
      expect(report.seenNotSold).toEqual([]);
      expect(report.soldOutWanted).toEqual([]);
      expect(report.sources).toBeNull();
    });

    it('passes on why the views are missing', () => {
      const report = build({
        pageViews: { status: 'unavailable' },
        referrers: { status: 'unavailable' },
      });
      expect(report.viewsStatus).toBe('unavailable');
    });
  });

  it('is empty, with zero totals, when nothing sold and nothing was viewed', () => {
    const report = build({ pageViews: views({}), referrers: NO_SOURCES });
    expect(report.totals).toEqual({
      units: 0,
      revenue: 0,
      orders: 0,
      views: 0,
    });
    expect(report.products).toEqual([]);
    expect(report.categories).toEqual([]);
    expect(report.sources).toEqual([]);
  });

  it('joins sales and views per product', () => {
    const report = build({
      sales: [sale('a', 2, 200_000, 1)],
      products: [product('a'), product('b')],
      pageViews: views({ '/product/a': 40, '/product/b': 10 }),
    });
    expect(report.products).toEqual([
      expect.objectContaining({
        slug: 'a',
        units: 2,
        revenue: 200_000,
        orders: 1,
        views: 40,
      }),
      expect.objectContaining({ slug: 'b', units: 0, revenue: 0, views: 10 }),
    ]);
    expect(report.totals).toEqual({
      units: 2,
      revenue: 200_000,
      orders: 1,
      views: 50,
    });
  });

  it('adds up every path that names the same product', () => {
    const report = build({
      products: [product('a')],
      pageViews: views({
        '/product/a': 5,
        '/product/a/': 2,
        '/product/a?utm_source=ig': 3,
      }),
    });
    expect(report.products[0]!.views).toBe(10);
  });

  it('ignores non-product paths and slugs with no product', () => {
    const report = build({
      products: [product('a')],
      pageViews: views({
        '/': 500,
        '/shop': 90,
        '/product/gone': 30,
        '/product/a': 1,
      }),
    });
    expect(report.products.map(({ slug }) => slug)).toEqual(['a']);
    expect(report.totals.views).toBe(1);
  });

  it('titles a family member with its label', () => {
    const report = build({
      sales: [sale('a', 1, 1)],
      products: [
        product('a', { variantOf: 'id-head', variantLabel: '۲ کیلو' }),
      ],
    });
    expect(report.products[0]!.title).toBe('محصول a — ۲ کیلو');
  });

  it('keeps a deactivated product that sold in the window', () => {
    const report = build({
      sales: [sale('a', 1, 1)],
      products: [product('a', { isActive: false })],
    });
    expect(report.products[0]).toMatchObject({ slug: 'a', isActive: false });
  });

  it('labels the category with its parent, or alone at the top level', () => {
    const report = build({
      sales: [sale('a', 1, 1), sale('b', 1, 1)],
      products: [
        product('a'),
        product('b', {
          categoryId: 'toys',
          categoryTitle: 'اسباب‌بازی',
          parentCategoryTitle: null,
        }),
      ],
    });
    expect(report.products.map(({ category }) => category).sort()).toEqual(
      ['اسباب‌بازی', 'غذا › غذای خشک'].sort(),
    );
  });

  describe('ordering', () => {
    it('puts the most sold first, then the most viewed, then revenue', () => {
      const report = build({
        sales: [
          sale('few', 1, 900),
          sale('many', 5, 100),
          sale('rich', 1, 5000),
        ],
        products: [
          product('few'),
          product('many'),
          product('rich'),
          product('seen'),
        ],
        pageViews: views({ '/product/few': 50, '/product/seen': 70 }),
      });
      expect(report.products.map(({ slug }) => slug)).toEqual([
        'many',
        'few',
        'rich',
        'seen',
      ]);
    });

    it(`keeps the table to ${PRODUCT_TABLE_SIZE} rows, the totals to all`, () => {
      const slugs = Array.from(
        { length: PRODUCT_TABLE_SIZE + 5 },
        (_, i) => `p${i}`,
      );
      const report = build({
        sales: slugs.map((slug) => sale(slug, 1, 10)),
        products: slugs.map((slug) => product(slug)),
      });
      expect(report.products).toHaveLength(PRODUCT_TABLE_SIZE);
      expect(report.totals.units).toBe(PRODUCT_TABLE_SIZE + 5);
    });
  });

  describe('roll-ups', () => {
    it('sums products into their primary category, most sold first', () => {
      const report = build({
        sales: [sale('a', 1, 100), sale('b', 2, 200), sale('c', 4, 50)],
        products: [
          product('a'),
          product('b'),
          product('c', {
            categoryId: 'toys',
            categoryTitle: 'اسباب‌بازی',
            parentCategoryTitle: null,
          }),
        ],
        pageViews: views({ '/product/a': 10, '/product/b': 5 }),
      });
      expect(report.categories).toEqual([
        {
          key: 'toys',
          label: 'اسباب‌بازی',
          units: 4,
          revenue: 50,
          orders: 4,
          views: 0,
        },
        {
          key: 'cat-food',
          label: 'غذا › غذای خشک',
          units: 3,
          revenue: 300,
          orders: 3,
          views: 15,
        },
      ]);
    });
  });

  describe('«زیاد دیده، کم فروخته»', () => {
    it('lists viewed products that sold nothing, most viewed first', () => {
      const report = build({
        sales: [sale('sold', 1, 1)],
        products: [product('sold'), product('low'), product('high')],
        pageViews: views({
          '/product/sold': 999,
          '/product/low': 3,
          '/product/high': 30,
        }),
      });
      expect(report.seenNotSold.map(({ slug }) => slug)).toEqual([
        'high',
        'low',
      ]);
    });

    it('leaves out a deactivated product: there is nothing to fix on it', () => {
      const report = build({
        products: [product('retired', { isActive: false }), product('live')],
        pageViews: views({ '/product/retired': 90, '/product/live': 3 }),
      });
      expect(report.seenNotSold.map(({ slug }) => slug)).toEqual(['live']);
    });

    it('leaves out a sold-out product: it cannot sell, and has its own list', () => {
      const report = build({
        products: [product('empty', { stock: 0 }), product('live')],
        pageViews: views({ '/product/empty': 90, '/product/live': 3 }),
      });
      expect(report.seenNotSold.map(({ slug }) => slug)).toEqual(['live']);
      expect(report.soldOutWanted.map(({ slug }) => slug)).toEqual(['empty']);
    });

    it(`keeps ${ACTION_LIST_SIZE}`, () => {
      const slugs = Array.from(
        { length: ACTION_LIST_SIZE + 2 },
        (_, i) => `p${i}`,
      );
      const report = build({
        products: slugs.map((slug) => product(slug)),
        pageViews: views(
          Object.fromEntries(slugs.map((s, i) => [`/product/${s}`, i + 1])),
        ),
      });
      expect(report.seenNotSold).toHaveLength(ACTION_LIST_SIZE);
      expect(report.seenNotSold[0]!.slug).toBe(`p${ACTION_LIST_SIZE + 1}`);
    });
  });

  describe('«ناموجود ولی پرتقاضا»', () => {
    it('lists active sold-out products people still open, most viewed first', () => {
      const report = build({
        sales: [sale('soldout-sold', 1, 1)],
        products: [
          product('soldout', { stock: 0 }),
          product('soldout-sold', { stock: 0 }),
          product('instock'),
          product('retired', { stock: 0, isActive: false }),
        ],
        pageViews: views({
          '/product/soldout': 5,
          '/product/soldout-sold': 20,
          '/product/instock': 50,
          '/product/retired': 80,
        }),
      });
      expect(report.soldOutWanted.map(({ slug }) => slug)).toEqual([
        'soldout-sold',
        'soldout',
      ]);
    });

    it('leaves out a sold-out product nobody opened', () => {
      const report = build({
        sales: [sale('a', 1, 1)],
        products: [product('a', { stock: 0 })],
        pageViews: views({}),
      });
      expect(report.soldOutWanted).toEqual([]);
    });
  });

  describe('traffic sources', () => {
    it('folds domains into families, most visits first', () => {
      const report = build({
        referrers: views({
          'instagram.com': 30,
          'l.instagram.com': 25,
          'www.google.com': 40,
          'example.com': 2,
        }),
      });
      expect(report.sources).toEqual([
        { label: 'اینستاگرام', visits: 55 },
        { label: 'گوگل', visits: 40 },
        { label: 'example.com', visits: 2 },
      ]);
    });

    it(`keeps ${SOURCE_LIST_SIZE}`, () => {
      const report = build({
        referrers: views(
          Object.fromEntries(
            Array.from({ length: SOURCE_LIST_SIZE + 3 }, (_, i) => [
              `s${i}.test`,
              i + 1,
            ]),
          ),
        ),
      });
      expect(report.sources).toHaveLength(SOURCE_LIST_SIZE);
    });

    it('stands alone: sources can be there while page views are not', () => {
      const report = build({
        pageViews: { status: 'unavailable' },
        referrers: views({ 't.me': 4 }),
      });
      expect(report.sources).toEqual([{ label: 'تلگرام', visits: 4 }]);
    });
  });

  describe('loadProductInsights', () => {
    const NOW = new Date('2026-10-11T10:00:00.000Z');

    it('reads the window, then the products that sold or were viewed', async () => {
      vi.mocked(OrderDao.salesByProductSince).mockResolvedValue([
        sale('sold', 2, 200, 1),
      ]);
      vi.mocked(readUmamiMetric).mockImplementation(async (kind) =>
        kind === 'pages'
          ? views({
              '/product/seen': 4,
              '/product/seen?ref=ig': 1,
              '/product/sold/': 2,
              '/shop': 50,
            })
          : NO_SOURCES,
      );
      vi.mocked(ProductDao.insightRows).mockResolvedValue([
        product('sold'),
        product('seen'),
      ]);

      const report = await loadProductInsights(7, NOW);

      expect(OrderDao.salesByProductSince).toHaveBeenCalledWith(
        new Date(NOW.getTime() - 7 * 24 * 60 * 60_000),
      );
      expect(readUmamiMetric).toHaveBeenCalledWith('pages', 7, NOW);
      expect(readUmamiMetric).toHaveBeenCalledWith('referrers', 7, NOW);
      expect(ProductDao.insightRows).toHaveBeenCalledWith({
        ids: ['id-sold'],
        slugs: ['seen', 'sold'],
      });
      expect(report.products.map(({ slug, views: v }) => [slug, v])).toEqual([
        ['sold', 2],
        ['seen', 5],
      ]);
    });

    it('asks for no slugs when Umami gave no views', async () => {
      vi.mocked(OrderDao.salesByProductSince).mockResolvedValue([]);
      vi.mocked(readUmamiMetric).mockResolvedValue({ status: 'unavailable' });
      vi.mocked(ProductDao.insightRows).mockResolvedValue([]);

      const report = await loadProductInsights(30, NOW);

      expect(ProductDao.insightRows).toHaveBeenCalledWith({
        ids: [],
        slugs: [],
      });
      expect(report.viewsStatus).toBe('unavailable');
      expect(report.sources).toBeNull();
    });
  });
});
