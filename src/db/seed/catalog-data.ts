// The demo catalog's raw data: the six categories and eight products of the
// design prototype (`design/src/app/App.tsx`), with its own Persian titles,
// brands, benefit lines, SKUs and integer-Toman prices — plus the three
// sub-categories and two products this shop's own stories need, appended.
//
// Deliberately free of database imports, so the checks on this data — image
// files present, slugs legal, prices whole Toman — run without a database.
// `seedCatalog` in ./catalog.ts writes it.
//
// `objectKey` is a storage key, not a URL. Until the admin story puts the
// storage interface behind it, the dev stand-in is a committed file under
// `public/`, so `products/cat-toy.jpg` is served at `/products/cat-toy.jpg`.
import { PET_TYPES, type PetType } from '@/db/schema/catalog';

export const SEED_CATEGORIES = [
  { title: 'غذای خشک', slug: 'dry-food', sortOrder: 1 },
  { title: 'غذای تر', slug: 'wet-food', sortOrder: 2 },
  { title: 'تشویقی', slug: 'treats', sortOrder: 3 },
  { title: 'مکمل', slug: 'supplements', sortOrder: 4 },
  { title: 'اسباب‌بازی', slug: 'toys', sortOrder: 5 },
  { title: 'بهداشت', slug: 'hygiene', sortOrder: 6 },
] as const;

/**
 * One level of sub-categories, kept in an export of its own rather than mixed
 * into `SEED_CATEGORIES`: the home strip shows top-level categories only and
 * has a photo per slug in code (`CATEGORY_IMAGES`), and the quiz deep-links at
 * top-level shelves. Both read `SEED_CATEGORIES` and would demand a photo, or
 * a quiz answer, for every sub-category added here.
 *
 * `parentSlug` is typed from `SEED_CATEGORIES`, so a sub-category under a
 * sub-category — or under nothing — fails `pnpm type-check`, not a test run.
 */
export const SEED_SUBCATEGORIES = [
  {
    title: 'شامپو و نظافت',
    slug: 'grooming',
    sortOrder: 1,
    parentSlug: 'hygiene',
  },
  { title: 'مالت', slug: 'malt', sortOrder: 1, parentSlug: 'supplements' },
  {
    title: 'مولتی‌ویتامین',
    slug: 'multivitamin',
    sortOrder: 2,
    parentSlug: 'supplements',
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
  /** The prototype's own SKUs — the admin screens display these. */
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
  petTypes: PetType[];
  imageKeys: string[];
  /**
   * «۱۰ کیلوگرم», «لاوندر» — what tells this member from its siblings. Set on
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
    title: 'غذای خشک پرمیوم گربه بالغ',
    slug: 'royal-canin-adult-cat-dry-food',
    sku: 'RC-CAT-ADULT-1K',
    brand: 'Royal Canin',
    benefit: 'مناسب گوارش حساس',
    price: 285_000,
    oldPrice: 320_000,
    stock: 24,
    categorySlug: 'dry-food',
    petTypes: [PET_TYPES.CAT],
    // The one seeded gallery. Every other product carries a single photo, which
    // left the thumbnail strip and the swipe track reachable only from a
    // product a spec had built itself — and the admin spec that builds one runs
    // at desktop width alone, so nothing walked the gallery at 375px at all.
    // The two extra keys are stand-ins from the bundled set; they only have to
    // be visibly different from each other and from the first.
    imageKeys: [
      'products/cat-dry-food.jpg',
      'products/cat-toy.jpg',
      'products/cat-supplement.jpg',
    ],
  },
  {
    title: 'غذای خشک سگ با مرغ و برنج',
    slug: 'hills-science-dog-chicken-rice',
    sku: 'HS-DOG-CHICKEN-2K',
    brand: "Hill's Science",
    benefit: 'تقویت سیستم ایمنی',
    price: 340_000,
    oldPrice: null,
    stock: 12,
    categorySlug: 'dry-food',
    petTypes: [PET_TYPES.DOG],
    imageKeys: ['products/dog-dry-food.jpg'],
  },
  {
    title: 'تشویقی طبیعی مرغ و سبزیجات گربه',
    slug: 'applaws-cat-chicken-veg-treats',
    sku: 'AP-CAT-TREAT-60',
    brand: 'Applaws',
    benefit: 'بدون مواد مصنوعی',
    price: 125_000,
    oldPrice: null,
    stock: 40,
    categorySlug: 'treats',
    petTypes: [PET_TYPES.CAT],
    imageKeys: ['products/cat-treats.jpg'],
  },
  {
    title: 'تشویقی نرم سگ با طعم گوشت',
    slug: 'ziwi-dog-meat-soft-treats',
    sku: 'ZW-DOG-TREAT-85',
    brand: 'Ziwi',
    benefit: 'بدون غلات، طبیعی ۱۰۰٪',
    price: 165_000,
    oldPrice: 190_000,
    stock: 18,
    categorySlug: 'treats',
    petTypes: [PET_TYPES.DOG],
    imageKeys: ['products/dog-treats.jpg'],
  },
  {
    // Deliberately out of stock: the design has an "فعلاً ناموجود است" state
    // and the storefront story needs a product that exercises it.
    title: 'غذای مرطوب سالمون و تن گربه',
    slug: 'sheba-cat-salmon-tuna-wet-food',
    sku: 'SH-CAT-WET-85',
    brand: 'Sheba',
    benefit: 'غنی از امگا ۳',
    price: 95_000,
    oldPrice: null,
    stock: 0,
    categorySlug: 'wet-food',
    petTypes: [PET_TYPES.CAT],
    imageKeys: ['products/cat-wet-food.jpg'],
  },
  {
    title: 'مکمل پوست و مو گربه',
    slug: 'beaphar-cat-skin-coat-supplement',
    sku: 'BP-CAT-SKIN-50',
    brand: 'Beaphar',
    benefit: 'کاهش ریزش مو',
    price: 178_000,
    oldPrice: 210_000,
    stock: 7,
    categorySlug: 'supplements',
    petTypes: [PET_TYPES.CAT],
    imageKeys: ['products/cat-supplement.jpg'],
  },
  {
    title: 'مکمل مفصل و استخوان سگ',
    slug: 'nutramax-dog-joint-supplement',
    sku: 'NX-DOG-JOINT-60',
    brand: 'Nutramax',
    benefit: 'تقویت غضروف و مفاصل',
    price: 215_000,
    oldPrice: null,
    stock: 15,
    categorySlug: 'supplements',
    petTypes: [PET_TYPES.DOG],
    // The prototype reuses the dog dry-food photo for this one.
    imageKeys: ['products/dog-dry-food.jpg'],
  },
  {
    // Low stock: drives the design's "تنها ۳ عدد باقی مانده" warning.
    title: 'اسباب‌بازی تعاملی پر و زنگوله',
    slug: 'smartykat-interactive-feather-bell-toy',
    sku: 'SK-CAT-TOY-01',
    brand: 'SmartyKat',
    benefit: 'تحریک غریزه شکار',
    price: 89_000,
    oldPrice: null,
    stock: 3,
    categorySlug: 'toys',
    petTypes: [PET_TYPES.CAT],
    imageKeys: ['products/cat-toy.jpg'],
  },
  // Appended, never inserted: the two rows above are pinned by index, and
  // e2e/support.ts picks the best-stocked, the sold-out and the low-stock
  // product out of this list.
  {
    // For both animals at once, so the slug and the SKU carry no pet segment —
    // the convention the product form's own hint teaches the admin.
    title: 'شامپو ملایم حیوان خانگی',
    slug: 'beaphar-gentle-shampoo-250',
    sku: 'BP-SHAMPOO-250',
    brand: 'Beaphar',
    benefit: 'بدون اشک، مناسب پوست حساس',
    price: 132_000,
    oldPrice: null,
    stock: 22,
    categorySlug: 'grooming',
    petTypes: [PET_TYPES.CAT, PET_TYPES.DOG],
    // No new downloads: the supplement bottle stands in for the shampoo.
    imageKeys: ['products/cat-supplement.jpg'],
  },
  {
    // Benyamin's own example of a product in two categories: a malt paste that
    // is also a multivitamin, so it is found under both shelves.
    title: 'خمیر مالت گربه با مولتی‌ویتامین',
    slug: 'gimcat-cat-malt-paste-100',
    sku: 'GC-CAT-MALT-100',
    brand: 'GimCat',
    benefit: 'کمک به دفع گلوله مویی',
    price: 148_000,
    oldPrice: 165_000,
    stock: 16,
    categorySlug: 'malt',
    extraCategorySlugs: ['multivitamin'],
    petTypes: [PET_TYPES.CAT],
    imageKeys: ['products/cat-supplement.jpg'],
  },
  // Benyamin's own example of one product in several smells: «our litter box
  // deodorant has different kinds of smells». The three rows below are one card
  // in the shop — the head is listed, the members are reached from its page.
  // «بدون بو» is cheaper on purpose, so the card exercises «از ۱۴۹٬۰۰۰ تومان»
  // rather than a plain price.
  {
    title: 'خوشبوکننده خاک گربه',
    slug: 'catsan-litter-deodorizer-lavender',
    sku: 'CS-DEO-LAVENDER',
    brand: 'Catsan',
    benefit: 'کنترل بو تا ۷ روز',
    price: 185_000,
    oldPrice: null,
    stock: 18,
    categorySlug: 'hygiene',
    petTypes: [PET_TYPES.CAT],
    // No new downloads, as with the shampoo above.
    imageKeys: ['products/cat-supplement.jpg'],
    variantLabel: 'لاوندر',
  },
  {
    title: 'خوشبوکننده خاک گربه',
    slug: 'catsan-litter-deodorizer-ocean',
    sku: 'CS-DEO-OCEAN',
    brand: 'Catsan',
    benefit: 'کنترل بو تا ۷ روز',
    price: 185_000,
    oldPrice: null,
    stock: 12,
    categorySlug: 'hygiene',
    petTypes: [PET_TYPES.CAT],
    imageKeys: ['products/cat-supplement.jpg'],
    variantLabel: 'اقیانوس',
    variantOfSku: 'CS-DEO-LAVENDER',
  },
  {
    title: 'خوشبوکننده خاک گربه',
    slug: 'catsan-litter-deodorizer-unscented',
    sku: 'CS-DEO-UNSCENTED',
    brand: 'Catsan',
    benefit: 'مناسب گربه‌های حساس',
    price: 149_000,
    oldPrice: null,
    stock: 9,
    categorySlug: 'hygiene',
    petTypes: [PET_TYPES.CAT],
    imageKeys: ['products/cat-supplement.jpg'],
    variantLabel: 'بدون بو',
    variantOfSku: 'CS-DEO-LAVENDER',
  },
];
