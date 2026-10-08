// The quiz's result link is built from fixed slugs (`QUIZ_NEEDS`), which a live
// catalogue may not have; it must never send a shopper to a category the shop
// would answer with a 404.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PET_LABELS } from '@/lib/catalog/product-query';
import { shopPath } from '@/lib/constant/paths';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import { JourneySection } from './journey';
import { QUIZ_AGES, QUIZ_NEEDS } from './quiz';

afterEach(cleanup);

/** Answers the quiz for a cat, the first age and `need`; returns the result link. */
const answer = (categorySlugs: string[], need: (typeof QUIZ_NEEDS)[number]) => {
  render(
    <JourneySection
      content={DEFAULT_CONTENT['home.journey']}
      categorySlugs={categorySlugs}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: PET_LABELS.cat }));
  fireEvent.click(screen.getByRole('button', { name: QUIZ_AGES[0] }));
  fireEvent.click(screen.getByRole('button', { name: need.label }));
  return screen.getByRole('link', { name: 'مشاهده محصولات' });
};

describe('JourneySection result link', () => {
  const need = QUIZ_NEEDS[1];

  it('opens the need’s category for the pet when the catalogue has it', () => {
    expect(answer([need.category], need).getAttribute('href')).toBe(
      shopPath({ category: need.category, pet: 'cat' }),
    );
  });

  it('opens the pet’s shelf when the catalogue has no such category', () => {
    expect(answer(['cat-wet-food'], need).getAttribute('href')).toBe(
      shopPath({ pet: 'cat' }),
    );
  });
});
