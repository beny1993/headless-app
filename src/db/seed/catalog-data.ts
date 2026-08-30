// The demo catalog's raw data: the six categories and eight products of the
// design prototype (`design/src/app/App.tsx`), with its own Persian titles,
// brands, benefit lines, SKUs and integer-Toman prices.
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
  // No demo product yet — the design lists the category, so the storefront's
  // category strip should show it.
  { title: 'بهداشت', slug: 'hygiene', sortOrder: 6 },
] as const;

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
  categorySlug: (typeof SEED_CATEGORIES)[number]['slug'];
  petType: PetType;
  imageKeys: string[];
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
    petType: PET_TYPES.CAT,
    imageKeys: ['products/cat-dry-food.jpg'],
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
    petType: PET_TYPES.DOG,
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
    petType: PET_TYPES.CAT,
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
    petType: PET_TYPES.DOG,
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
    petType: PET_TYPES.CAT,
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
    petType: PET_TYPES.CAT,
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
    petType: PET_TYPES.DOG,
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
    petType: PET_TYPES.CAT,
    imageKeys: ['products/cat-toy.jpg'],
  },
];
