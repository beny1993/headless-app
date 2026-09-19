// The personalized-journey quiz's questions and the one thing it computes:
// which shop filters its answers add up to.
//
// Entirely client-side and stateless — there is no backend for it, by the
// story's own acceptance criteria. The answers become a `/shop?…` deep link
// and nothing else is stored.
import {
  PET_EMOJI,
  PET_LABELS,
  PET_TYPE_VALUES,
  type PetType,
} from '@/lib/catalog/product-query';
import type { ShopFilters } from '@/lib/constant/paths';

// PET_TYPES comes from the client-safe schema module (no drizzle/pg in it),
// so the values are imported directly — the enum is the single source.
export const QUIZ_PETS = PET_TYPE_VALUES.map((value) => ({
  value,
  label: PET_LABELS[value],
  emoji: PET_EMOJI[value],
}));

/**
 * Asked because the design asks it and the summary sentence reads it back —
 * but the catalog has no age field, so it never becomes a filter. When
 * [[Story - Product Catalog Schema]] gains life-stage data this is where it
 * starts filtering.
 */
export const QUIZ_AGES = [
  'بچه (۰–۱ سال)',
  'جوان (۱–۷ سال)',
  'سالمند (۷+ سال)',
] as const;

export type QuizNeed = { label: string; category: string };

/**
 * The prototype's six needs, each mapped onto a real category slug. More than
 * one need can point at the same category — «آرامش» and «پوست و مو» are both
 * served by supplements — and that is preferable to inventing a category or
 * rewording the design's copy.
 */
export const QUIZ_NEEDS: readonly QuizNeed[] = [
  { label: 'پوست و مو', category: 'supplements' },
  { label: 'گوارش', category: 'wet-food' },
  { label: 'مفاصل', category: 'supplements' },
  { label: 'کنترل وزن', category: 'dry-food' },
  { label: 'سرگرمی', category: 'toys' },
  { label: 'آرامش', category: 'supplements' },
] as const;

export type QuizAnswers = {
  pet: PetType | null;
  need: QuizNeed | null;
};

/**
 * Answers → shop filters. An unanswered question contributes nothing rather
 * than a guess, so an abandoned quiz still lands somewhere useful.
 */
export function quizFilters({ pet, need }: QuizAnswers): ShopFilters {
  return { pet: pet ?? undefined, category: need?.category };
}
