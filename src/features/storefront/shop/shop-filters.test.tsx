// Pins the category panel's nesting, which no unit test can reach: `orderAsTree`
// hands this component a flat list with a `depth`, and the structure a screen
// reader hears — a sub-category's `<li>` inside its parent's `<li>` — exists
// only once React has rendered it. The indent alone is presentation; the nesting
// is the part that has to be announced.
//
// Also pins the single-tick rule: the panel mirrors one `?category=`, so ticking
// a sub-category must not also tick its parent.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ShopFilters, type ShopCategoryOption } from './shop-filters';
import { parseShopQuery } from './shop-query';

// The panel uses exactly one thing from the router.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(cleanup);

const OPTIONS: ShopCategoryOption[] = [
  { title: 'بهداشت', slug: 'hygiene', depth: 0 },
  { title: 'شامپو و نظافت', slug: 'grooming', depth: 1 },
  { title: 'اسباب‌بازی', slug: 'toys', depth: 0 },
];

const renderFilters = (search: Record<string, string> = {}) =>
  render(<ShopFilters query={parseShopQuery(search)} categories={OPTIONS} />);

it('nests a sub-category inside its parent’s list item', () => {
  renderFilters();

  const parent = screen.getByLabelText('بهداشت').closest('li')!;
  const sub = screen.getByLabelText('شامپو و نظافت').closest('li')!;
  const sibling = screen.getByLabelText('اسباب‌بازی').closest('li')!;

  expect(parent.contains(sub)).toBe(true);
  expect(parent.contains(sibling)).toBe(false);
});

it('ticks exactly one box — a sub-category never half-ticks its parent', () => {
  renderFilters({ category: 'grooming' });

  expect(
    (screen.getByLabelText('شامپو و نظافت') as HTMLInputElement).checked,
  ).toBe(true);
  expect((screen.getByLabelText('بهداشت') as HTMLInputElement).checked).toBe(
    false,
  );
});
