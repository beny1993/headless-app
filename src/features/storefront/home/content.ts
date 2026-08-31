// The home page's editorial content — the parts that are not catalog data.
//
// Kept in one module rather than inline in the sections so the checks that
// matter can run without a browser: every photo is a committed local file (the
// design review's blocker 1), and every deep link names a category that really
// exists (its "no dead navigation" rule).
//
// Paths are public/ URLs, the same convention `product_images.object_key`
// follows: `/products/cat-toy.jpg` is `public/products/cat-toy.jpg`.
import { PET_TYPES, type PetType } from '@/db/schema/catalog';

/**
 * The category strip's photography, by category slug.
 *
 * Categories are database rows and can be added in the admin panel, so this is
 * a lookup with a miss — an unmapped category still renders, on a plain
 * surface instead of a photo. Nothing here is a source of category *titles*;
 * those come from `CategoryDao`.
 */
export const CATEGORY_IMAGES: Record<string, string> = {
  'dry-food': '/products/cat-dry-food.jpg',
  'wet-food': '/products/cat-wet-food.jpg',
  treats: '/products/cat-treats.jpg',
  supplements: '/products/cat-supplement.jpg',
  toys: '/products/cat-toy.jpg',
  hygiene: '/site/cat-hygiene.jpg',
};

/** The hero photograph. Large, above the fold, and the page's LCP element. */
export const HERO_IMAGE = '/site/hero-home.jpg';

/** The «راهنمای اسموکی» section's photograph. */
export const STORY_IMAGE = '/site/cat-hygiene.jpg';

export type LifeMoment = {
  title: string;
  desc: string;
  image: string;
  /** Rendered as decoration next to the title, not as a functional icon. */
  emoji: string;
  filters: { category: string; pet: PetType };
};

/**
 * «خرید بر اساس لحظه» — five editorial entry points into the shop. The
 * prototype linked them all at the bare shop page; each one now carries the
 * filter its own copy promises.
 */
export const LIFE_MOMENTS: readonly LifeMoment[] = [
  {
    title: 'وقت غذا',
    desc: 'بهترین تغذیه برای سلامت روزانه',
    image: '/products/cat-dry-food.jpg',
    emoji: '🐱',
    filters: { category: 'dry-food', pet: PET_TYPES.CAT },
  },
  {
    title: 'وقت بازی',
    desc: 'سرگرمی هوشمند برای ذهن فعال',
    image: '/products/cat-toy.jpg',
    emoji: '🐱',
    filters: { category: 'toys', pet: PET_TYPES.CAT },
  },
  {
    title: 'وقت تشویق',
    desc: 'پاداش کوچک برای رفتار خوب',
    image: '/products/dog-treats.jpg',
    emoji: '🐶',
    filters: { category: 'treats', pet: PET_TYPES.DOG },
  },
  {
    title: 'مراقبت روزانه',
    desc: 'پوست، مو و بهداشت',
    image: '/products/cat-supplement.jpg',
    emoji: '🐱',
    filters: { category: 'supplements', pet: PET_TYPES.CAT },
  },
  {
    title: 'وعده‌ی سگ',
    desc: 'انرژی روزانه برای یک سگ فعال',
    image: '/products/dog-dry-food.jpg',
    emoji: '🐶',
    filters: { category: 'dry-food', pet: PET_TYPES.DOG },
  },
];

export type RoutineSlot = {
  label: string;
  sub: string;
  emoji: string;
  /** Category slugs; the tiles take their titles from the database. */
  categories: readonly string[];
};

/**
 * «روتین روزانه» — four times of day, each pointing at the categories that
 * serve it. The prototype listed invented product names here («آبخوری هوشمند»,
 * «تخت راحت») which all linked to one unrelated product page; real categories
 * keep the section's shape without shipping fake products or dead links.
 */
export const ROUTINE: readonly RoutineSlot[] = [
  { label: 'صبح', sub: 'غذا', emoji: '🌅', categories: ['dry-food'] },
  { label: 'ظهر', sub: 'بازی', emoji: '☀️', categories: ['toys'] },
  {
    label: 'عصر',
    sub: 'مراقبت',
    emoji: '🌤️',
    categories: ['supplements', 'hygiene'],
  },
  {
    label: 'شب',
    sub: 'آرامش',
    emoji: '🌙',
    categories: ['treats', 'wet-food'],
  },
];

export type CommunityPet = {
  name: string;
  owner: string;
  quote: string;
  image: string;
  /** Tailwind row span — the two portraits that run tall in the mosaic. */
  tall: boolean;
};

/**
 * «خانواده اسموکی» — a static, bundled photo wall, by the story's own AC.
 * It links nowhere on purpose: there is no community feature behind it, and a
 * fake click target was exactly what the design review objected to.
 */
export const COMMUNITY_PETS: readonly CommunityPet[] = [
  {
    name: 'لونا',
    owner: 'سارا',
    quote: 'لونا عاشق این تشویقیه.',
    image: '/site/community-luna.jpg',
    tall: true,
  },
  {
    name: 'آرکو',
    owner: 'علی',
    quote: 'هر روز صبح منتظر وعده‌اشه!',
    image: '/products/dog-dry-food.jpg',
    tall: false,
  },
  {
    name: 'رکسی',
    owner: 'امیر',
    quote: 'سفر بدون رکسی معنی نداره.',
    image: '/products/dog-treats.jpg',
    tall: false,
  },
  {
    name: 'بارون',
    owner: 'کاوه',
    quote: 'بارون با این اسباب‌بازی ساعت‌ها بازی می‌کنه.',
    image: '/site/community-baron.jpg',
    tall: true,
  },
  {
    name: 'میشا',
    owner: 'نیلوفر',
    quote: 'بهترین خواب دنیا رو داره.',
    image: '/site/community-misha.jpg',
    tall: false,
  },
];
