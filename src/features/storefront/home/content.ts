// The home page's non-editable, code-side data — the parts that are NOT content.
//
// Under the v2 CMS rule the editorial *labels* (the moment cards' title/desc/photo,
// the routine tabs' label/sub) moved into `DEFAULT_CONTENT` (`src/lib/content/`);
// what stays here is everything catalog-coupled or destination-bearing: the
// category photography, and the fixed link TARGETS the sections zip with their
// editable labels by index. Kept in one module so the checks that matter run
// without a browser: every category photo is a committed local file (the design
// review's blocker 1), and every deep link names a category that really exists
// (its "no dead navigation" rule) — `content.test.ts` asserts both on these arrays.
//
// Paths are public/ URLs, the same convention `product_images.object_key` follows:
// `/products/cat-toy.jpg` is `public/products/cat-toy.jpg`.
// Type-only: this module is imported by client components, and a *value* import of
// the schema ships `pgTable`/`pg-core` to the browser. The pet literals below are
// checked against `PetType` by the `satisfies` on `LIFE_MOMENT_TARGETS`, so a
// renamed enum value still breaks `pnpm type-check`.
import type { PetType } from '@/db/schema/catalog';

/**
 * The category strip's photography, by category slug.
 *
 * Categories are database rows and can be added in the admin panel, so this is
 * a lookup with a miss — an unmapped category still renders, on a plain
 * surface instead of a photo. Nothing here is a source of category *titles*;
 * those come from `CategoryDao`. (A `categories.image_key` catalog story would
 * move these into the database later — flagged to the PM, out of scope here.)
 */
export const CATEGORY_IMAGES: Record<string, string> = {
  'dry-food': '/products/cat-dry-food.jpg',
  'wet-food': '/products/cat-wet-food.jpg',
  treats: '/products/cat-treats.jpg',
  supplements: '/products/cat-supplement.jpg',
  toys: '/products/cat-toy.jpg',
  hygiene: '/site/cat-hygiene.jpg',
};

export type LifeMomentTarget = {
  /** Rendered as decoration next to the card title, not as a functional icon. */
  emoji: string;
  filters: { category: string; pet: PetType };
};

/**
 * «خرید بر اساس لحظه» — the five cards' fixed destinations, zipped by index with
 * the editable `home.moments.cards` labels. Each card links at the filter its own
 * copy promises. `as const satisfies` keeps the tuple length fixed (for the parity
 * test) AND checks each `pet` against `PetType`.
 */
export const LIFE_MOMENT_TARGETS = [
  { emoji: '🐱', filters: { category: 'dry-food', pet: 'cat' } },
  { emoji: '🐱', filters: { category: 'toys', pet: 'cat' } },
  { emoji: '🐶', filters: { category: 'treats', pet: 'dog' } },
  { emoji: '🐱', filters: { category: 'supplements', pet: 'cat' } },
  { emoji: '🐶', filters: { category: 'dry-food', pet: 'dog' } },
] as const satisfies readonly LifeMomentTarget[];

export type RoutineTarget = {
  emoji: string;
  /** Category slugs; the tiles take their titles from the database. */
  categories: readonly string[];
};

/**
 * «روتین روزانه» — the four times of day, each pointing at the categories that
 * serve it, zipped by index with the editable `home.routine.slots` labels. The
 * prototype listed invented product names here; real categories keep the section's
 * shape without shipping fake products or dead links.
 */
export const ROUTINE_TARGETS = [
  { emoji: '🌅', categories: ['dry-food'] },
  { emoji: '☀️', categories: ['toys'] },
  { emoji: '🌤️', categories: ['supplements', 'hygiene'] },
  { emoji: '🌙', categories: ['treats', 'wet-food'] },
] as const satisfies readonly RoutineTarget[];
