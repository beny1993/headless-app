import { describe, expect, it } from 'vitest';
import {
  QUIZ_AGES,
  QUIZ_NEEDS,
  QUIZ_PETS,
  quizFilters,
} from '@/features/storefront/home/quiz';
import { SEED_CATEGORIES } from '@/db/seed/catalog-data';
import { PET_TYPES } from '@/db/schema/catalog';
import { shopPath } from '@/lib/constant/paths';

const need = (label: string) => {
  const found = QUIZ_NEEDS.find((option) => option.label === label);
  if (!found) throw new Error(`no such quiz need: ${label}`);
  return found;
};

describe('quiz options', () => {
  it('offers the prototype’s two pets, three ages and six needs', () => {
    expect(QUIZ_PETS.map((pet) => pet.value)).toEqual([
      PET_TYPES.CAT,
      PET_TYPES.DOG,
    ]);
    expect(QUIZ_AGES).toHaveLength(3);
    expect(QUIZ_NEEDS.map((option) => option.label)).toEqual([
      'پوست و مو',
      'گوارش',
      'مفاصل',
      'کنترل وزن',
      'سرگرمی',
      'آرامش',
    ]);
  });

  it('points every need at a category that exists in the catalog', () => {
    // The whole point of the quiz is the deep link. A typo here ships a
    // «مشاهده محصولات» button that lands on an empty shop.
    const slugs = new Set<string>(SEED_CATEGORIES.map((row) => row.slug));

    for (const option of QUIZ_NEEDS) {
      expect(slugs).toContain(option.category);
    }
  });

  it('maps each need to its intended category, not merely a real one', () => {
    // Pinning the whole table, because "the slug exists" is too weak: swapping
    // «مفاصل» from supplements to dry-food leaves every other assertion green
    // and ships a button that quietly lands on the wrong shelf. Three of these
    // six are also asserted through `quizFilters` below; the other three had
    // no coverage at all.
    expect(
      Object.fromEntries(QUIZ_NEEDS.map((o) => [o.label, o.category])),
    ).toEqual({
      'پوست و مو': 'supplements',
      گوارش: 'wet-food',
      مفاصل: 'supplements',
      'کنترل وزن': 'dry-food',
      سرگرمی: 'toys',
      آرامش: 'supplements',
    });
  });
});

describe('quizFilters', () => {
  it('maps both answers onto the catalog API’s own parameter names', () => {
    expect(
      quizFilters({ pet: PET_TYPES.CAT, need: need('پوست و مو') }),
    ).toEqual({ pet: 'cat', category: 'supplements' });
  });

  it('builds the deep link the shop page reads', () => {
    const href = shopPath(
      quizFilters({ pet: PET_TYPES.DOG, need: need('سرگرمی') }),
    );

    expect(href).toBe('/shop?category=toys&pet=dog');
  });

  it('drops an unanswered question instead of guessing', () => {
    expect(quizFilters({ pet: PET_TYPES.DOG, need: null })).toEqual({
      pet: 'dog',
      category: undefined,
    });
    expect(quizFilters({ pet: null, need: need('گوارش') })).toEqual({
      pet: undefined,
      category: 'wet-food',
    });
  });

  it('sends an abandoned quiz to the unfiltered shop', () => {
    expect(shopPath(quizFilters({ pet: null, need: null }))).toBe('/shop');
  });

  it('separates the needs it can filter on from the ones it cannot', () => {
    // Age is asked because the design asks it and the summary sentence reads
    // it back — but no catalog field records it, so it must not silently
    // become a filter. Two answers differing only by age deep-link the same.
    const answers = { pet: PET_TYPES.CAT, need: need('مفاصل') };

    expect(Object.keys(quizFilters(answers)).sort()).toEqual([
      'category',
      'pet',
    ]);
  });
});
