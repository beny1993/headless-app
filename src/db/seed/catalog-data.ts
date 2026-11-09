// The demo catalog's raw data: six categories and a dozen products of a small
// general store, with Persian titles, invented brands, benefit lines, SKUs and
// integer-Toman prices. Every row is here for a reason a test or a story needs:
// a gallery, a sold-out product, a low-stock one, a product filed under two
// categories, and a family whose head is sold out and cheapest.
//
// Deliberately free of database imports, so the checks on this data — image
// files present, slugs legal, prices whole Toman — run without a database.
// `seedCatalog` in ./catalog.ts writes it.
//
// `objectKey` is a storage key, not a URL. The dev stand-in is a committed file
// under `public/`, so `products/mug.jpg` is served at `/products/mug.jpg`.

export const SEED_CATEGORIES = [
  {
    title: 'آشپزخانه',
    slug: 'kitchen',
    sortOrder: 1,
    imageKey: 'products/mug.jpg',
  },
  {
    title: 'نوشت‌افزار',
    slug: 'stationery',
    sortOrder: 2,
    imageKey: 'products/notebook.jpg',
  },
  {
    title: 'صوتی و دیجیتال',
    slug: 'audio',
    sortOrder: 3,
    imageKey: 'products/headphones.jpg',
  },
  {
    title: 'دکوراسیون',
    slug: 'home-decor',
    sortOrder: 4,
    imageKey: 'products/lamp.jpg',
  },
  {
    title: 'کیف و سفر',
    slug: 'bags',
    sortOrder: 5,
    imageKey: 'products/backpack.jpg',
  },
  {
    title: 'سرگرمی',
    slug: 'games',
    sortOrder: 6,
    imageKey: 'products/puzzle.jpg',
  },
] as const;

/**
 * One level of sub-categories, kept in an export of its own rather than mixed
 * into `SEED_CATEGORIES`: the home strip shows top-level categories only, each
 * with the photo its seed row carries, and would demand a photo for every
 * sub-category added there.
 *
 * `parentSlug` is typed from `SEED_CATEGORIES`, so a sub-category under a
 * sub-category — or under nothing — fails `pnpm type-check`, not a test run.
 */
export const SEED_SUBCATEGORIES = [
  {
    title: 'روشنایی',
    slug: 'lighting',
    sortOrder: 1,
    parentSlug: 'home-decor',
  },
  { title: 'ماگ و لیوان', slug: 'mugs', sortOrder: 1, parentSlug: 'kitchen' },
  {
    title: 'بطری و فلاسک',
    slug: 'bottles',
    sortOrder: 2,
    parentSlug: 'kitchen',
  },
] as const satisfies readonly {
  title: string;
  slug: string;
  sortOrder: number;
  parentSlug: (typeof SEED_CATEGORIES)[number]['slug'];
}[];

/** A product may be filed under a top-level category or under a sub-category. */
type SeedCategorySlug =
  | (typeof SEED_CATEGORIES)[number]['slug']
  | (typeof SEED_SUBCATEGORIES)[number]['slug'];

type SeedProduct = {
  title: string;
  slug: string;
  /** What the admin screens display; derived from the slug by convention. */
  sku: string;
  brand: string;
  benefit: string;
  /** Integer Toman. */
  price: number;
  oldPrice: number | null;
  stock: number;
  /** The main category — the one the breadcrumb follows. */
  categorySlug: SeedCategorySlug;
  /** Additional categories the product is also found under. Never the main one. */
  extraCategorySlugs?: SeedCategorySlug[];
  imageKeys: string[];
  /**
   * «۷۵۰ میلی‌لیتر», «وانیل» — what tells this member from its siblings. Set on
   * the family's head too; absent on a standalone product.
   */
  variantLabel?: string;
  /**
   * The sku of the product this one is a variant of. By sku rather than by id
   * because the seed has no ids until it runs — the runner resolves it, and a
   * head must therefore appear **earlier in this list** than its members.
   */
  variantOfSku?: string;
};

export const SEED_PRODUCTS: SeedProduct[] = [
  {
    title: 'ماگ سرامیکی لعابی',
    slug: 'clayform-glazed-mug-350',
    sku: 'CF-MUG-350',
    brand: 'Clayform',
    benefit: 'مناسب ماشین ظرف‌شویی',
    price: 285_000,
    oldPrice: 320_000,
    stock: 24,
    categorySlug: 'kitchen',
    // The one seeded gallery. Every other product carries a single photo, which
    // left the thumbnail strip and the swipe track reachable only from a
    // product a spec had built itself — and the admin spec that builds one runs
    // at desktop width alone, so nothing walked the gallery at 375px at all.
    // The two extra keys are stand-ins from the bundled set; they only have to
    // be visibly different from each other and from the first.
    imageKeys: [
      'products/mug.jpg',
      'products/bottle.jpg',
      'products/candle.jpg',
    ],
  },
  {
    title: 'بطری آب استیل',
    slug: 'nordwell-steel-bottle-750',
    sku: 'NW-BOTTLE-750',
    brand: 'Nordwell',
    benefit: 'سرد نگه داشتن تا ۲۴ ساعت',
    price: 340_000,
    oldPrice: null,
    stock: 12,
    categorySlug: 'kitchen',
    imageKeys: ['products/bottle.jpg'],
  },
  {
    title: 'دفتر یادداشت جلد سخت',
    slug: 'pagecraft-hardcover-notebook-a5',
    sku: 'PC-NOTEBOOK-A5',
    brand: 'Pagecraft',
    benefit: 'کاغذ ۱۰۰ گرمی بدون پشت‌زدگی',
    price: 125_000,
    oldPrice: null,
    stock: 40,
    categorySlug: 'stationery',
    imageKeys: ['products/notebook.jpg'],
  },
  {
    title: 'دفتر برنامه‌ریزی هفتگی',
    slug: 'pagecraft-weekly-planner',
    sku: 'PC-PLANNER-WEEK',
    brand: 'Pagecraft',
    benefit: 'بدون تاریخ، از هر هفته شروع کن',
    price: 165_000,
    oldPrice: 190_000,
    stock: 18,
    categorySlug: 'stationery',
    imageKeys: ['products/notebook.jpg'],
  },
  {
    // Deliberately out of stock: the design has an "فعلاً ناموجود است" state
    // and the storefront story needs a product that exercises it.
    title: 'هدفون سیمی روگوشی',
    slug: 'sonora-wired-headphones',
    sku: 'SN-HEADPHONES-W',
    brand: 'Sonora',
    benefit: 'صدای شفاف با کابل جداشدنی',
    price: 95_000,
    oldPrice: null,
    stock: 0,
    categorySlug: 'audio',
    imageKeys: ['products/headphones.jpg'],
  },
  {
    title: 'کوله‌پشتی روزانه',
    slug: 'trailpack-daypack-20l',
    sku: 'TP-DAYPACK-20L',
    brand: 'Trailpack',
    benefit: 'ضدآب، با جای لپ‌تاپ',
    price: 178_000,
    oldPrice: 210_000,
    stock: 7,
    categorySlug: 'bags',
    imageKeys: ['products/backpack.jpg'],
  },
  {
    title: 'چراغ رومیزی چوبی',
    slug: 'lumen-wooden-desk-lamp',
    sku: 'LM-LAMP-DESK',
    brand: 'Lumen',
    benefit: 'نور گرم و قابل تنظیم',
    price: 215_000,
    oldPrice: null,
    stock: 15,
    categorySlug: 'home-decor',
    imageKeys: ['products/lamp.jpg'],
  },
  {
    // Low stock: drives the design's "تنها ۳ عدد باقی مانده" warning.
    title: 'پازل ۵۰۰ تکه',
    slug: 'tessera-jigsaw-puzzle-500',
    sku: 'TS-PUZZLE-500',
    brand: 'Tessera',
    benefit: 'سرگرمی خانوادگی برای عصرهای آرام',
    price: 89_000,
    oldPrice: null,
    stock: 3,
    categorySlug: 'games',
    imageKeys: ['products/puzzle.jpg'],
  },
  // Appended, never inserted: the rows above are pinned by index, and
  // e2e/support.ts picks the best-stocked, the sold-out and the low-stock
  // product out of this list.
  {
    // Filed under a sub-category only, so a parent shelf has to reach it
    // through its child.
    title: 'ریسه نوری LED',
    slug: 'lumen-led-string-lights-5m',
    sku: 'LM-LED-5M',
    brand: 'Lumen',
    benefit: 'مصرف کم، مناسب فضای داخلی',
    price: 132_000,
    oldPrice: null,
    stock: 22,
    categorySlug: 'lighting',
    imageKeys: ['products/lamp.jpg'],
  },
  {
    // A product in two categories: a travel tumbler is a bottle and a mug at
    // once, so it is found under both shelves.
    title: 'لیوان سفری دوجداره',
    slug: 'nordwell-travel-tumbler-450',
    sku: 'NW-TUMBLER-450',
    brand: 'Nordwell',
    benefit: 'درب ضدنشت برای نوشیدنی گرم و سرد',
    price: 148_000,
    oldPrice: 165_000,
    stock: 16,
    categorySlug: 'bottles',
    extraCategorySlugs: ['mugs'],
    imageKeys: ['products/bottle.jpg'],
  },
  // One product in several scents. The three rows below are one card in the
  // shop — the head is listed, the members are reached from its page.
  // «وانیل», the head, is sold out and the cheapest on purpose. The card then
  // exercises both rules at once: it prints «از ۱۴۹٬۰۰۰ تومان», the cheapest
  // scent a shopper can buy, never the sold-out ۱۳۹٬۰۰۰, and it opens
  // «بدون رایحه», not a page with nothing to add to the cart.
  {
    title: 'شمع معطر سویا',
    slug: 'ember-soy-candle-vanilla',
    sku: 'EM-CANDLE-VANILLA',
    brand: 'Ember',
    benefit: 'تا ۴۰ ساعت سوختن',
    price: 139_000,
    oldPrice: null,
    stock: 0,
    categorySlug: 'home-decor',
    imageKeys: ['products/candle.jpg'],
    variantLabel: 'وانیل',
  },
  {
    title: 'شمع معطر سویا',
    slug: 'ember-soy-candle-cedar',
    sku: 'EM-CANDLE-CEDAR',
    brand: 'Ember',
    benefit: 'تا ۴۰ ساعت سوختن',
    price: 185_000,
    oldPrice: null,
    stock: 12,
    categorySlug: 'home-decor',
    imageKeys: ['products/candle.jpg'],
    variantLabel: 'سدر',
    variantOfSku: 'EM-CANDLE-VANILLA',
  },
  {
    title: 'شمع معطر سویا',
    slug: 'ember-soy-candle-unscented',
    sku: 'EM-CANDLE-UNSCENTED',
    brand: 'Ember',
    benefit: 'مناسب افراد حساس به بو',
    price: 149_000,
    oldPrice: null,
    stock: 9,
    categorySlug: 'home-decor',
    imageKeys: ['products/candle.jpg'],
    variantLabel: 'بدون رایحه',
    variantOfSku: 'EM-CANDLE-VANILLA',
  },
];
