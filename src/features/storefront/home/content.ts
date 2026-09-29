// The home page's non-editable, code-side data — the parts that are NOT content.
//
// Under the v2 CMS rule the editorial *labels* (the moment cards' title/desc/photo,
// the routine tabs' label/sub) moved into `DEFAULT_CONTENT` (`src/lib/content/`);
// what stays here is everything destination-bearing: the link TARGETS the
// sections zip with their editable labels by index (since destinations became
// content too, the fallbacks for a card or tab with no saved destination). Kept in
// one module so the check that matters runs without a browser: every deep link
// names a category that really exists (the design review's "no dead navigation"
// rule) — `content.test.ts` asserts it on these arrays. The category photos that
// used to live here are catalog data now (`categories.image_key`).
//
// Type-only: this module is imported by client components, and a *value* import of
// the schema ships `pgTable`/`pg-core` to the browser. The pet literals below are
// checked against `PetType` by the `satisfies` on `LIFE_MOMENT_TARGETS`, so a
// renamed enum value still breaks `pnpm type-check`.
import type { PetType } from '@/db/schema/catalog';
import { PET_EMOJI } from '@/lib/catalog/product-query';
import { LINK_TYPES, type Link } from '@/lib/content/link';

type LifeMomentTarget = {
  /** Rendered as decoration next to the card title, not as a functional icon. */
  emoji: string;
  filters: { category: string; pet: PetType };
};

/**
 * «خرید بر اساس لحظه» — the five cards' code destinations, zipped by index with
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

type RoutineTarget = {
  emoji: string;
  /** Category slugs; the tiles take their titles from the database. */
  categories: readonly string[];
};

/**
 * «روتین روزانه» — the four times of day, each pointing at the categories that
 * serve it unless the tab saved its own `categoryIds`, zipped by index with the
 * editable `home.routine.slots` labels. The
 * prototype listed invented product names here; real categories keep the section's
 * shape without shipping fake products or dead links.
 */
export const ROUTINE_TARGETS = [
  { emoji: '🌅', categories: ['dry-food'] },
  { emoji: '☀️', categories: ['toys'] },
  { emoji: '🌤️', categories: ['supplements', 'hygiene'] },
  { emoji: '🌙', categories: ['treats', 'wet-food'] },
] as const satisfies readonly RoutineTarget[];

/**
 * The emoji on moment card `index`: the code one (`LIFE_MOMENT_TARGETS`) until a
 * destination is saved, then that destination's pet — 🐾 when it names none — so
 * a card re-pointed from cat food to dog treats stops wearing a cat.
 */
export function momentEmoji(
  link: Link | null | undefined,
  index: number,
): string {
  if (!link) return LIFE_MOMENT_TARGETS[index].emoji;
  return link.type === LINK_TYPES.SHOP && link.pet ? PET_EMOJI[link.pet] : '🐾';
}
