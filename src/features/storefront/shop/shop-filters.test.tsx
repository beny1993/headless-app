// Pins the category panel's nesting, which no unit test can reach: `orderAsTree`
// hands this component a flat list with a `depth`, and the structure a screen
// reader hears — a sub-category's `<li>` inside its parent's `<li>` — exists
// only once React has rendered it. The indent alone is presentation; the nesting
// is the part that has to be announced.
//
// Also pins the single-tick rule: the panel mirrors one `?category=`, so ticking
// a sub-category must not also tick its parent.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShopFilters, type ShopCategoryOption } from './shop-filters';
import { parseShopQuery } from './shop-query';

// The panel uses exactly one thing from the router. A recorder, not a stub:
// the slider's whole contract is *when* it pushes, so the pushes are the
// assertion — mocked at the module edge, never the logic under test.
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

beforeEach(() => push.mockClear());

afterEach(cleanup);

const OPTIONS: ShopCategoryOption[] = [
  { title: 'بهداشت', slug: 'hygiene', depth: 0 },
  { title: 'شامپو و نظافت', slug: 'grooming', depth: 1 },
  { title: 'اسباب‌بازی', slug: 'toys', depth: 0 },
];

const BOUNDS = { min: 50_000, max: 500_000 };

const renderFilters = (search: Record<string, string> = {}) =>
  render(
    <ShopFilters
      query={parseShopQuery(search)}
      categories={OPTIONS}
      priceBounds={BOUNDS}
    />,
  );

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

describe('«پاک کردن همه»', () => {
  const clearAll = () => screen.getByText('پاک کردن همه');

  it('drops every filter it shows a chip for', () => {
    renderFilters({ category: 'toys', pet: 'cat', minPrice: '100000' });

    fireEvent.click(clearAll());

    const href = push.mock.calls[0][0] as string;
    expect(href).not.toContain('category');
    expect(href).not.toContain('pet');
    expect(href).not.toContain('minPrice');
  });

  it('keeps the search term and the sort, which have no chip', () => {
    // It used to be a bare link to `/shop`, which threw away both — neither is
    // shown beside this button, so neither is what the shopper asked to undo.
    renderFilters({ category: 'toys', q: 'غذا', sort: 'price-asc' });

    fireEvent.click(clearAll());

    const href = push.mock.calls[0][0] as string;
    expect(decodeURIComponent(href)).toContain('غذا');
    expect(href).toContain('price-asc');
    expect(href).not.toContain('category');
  });

  it('goes through the panel’s own navigation, so the mobile sheet closes', () => {
    // A link navigated past the sheet and left it open over the results it had
    // just changed. `push` is what the sheet's `onApply` rides on.
    renderFilters({ category: 'toys' });

    fireEvent.click(clearAll());

    expect(push).toHaveBeenCalledTimes(1);
  });
});

describe('the price slider', () => {
  const handles = () => ({
    low: screen.getByLabelText('کمترین قیمت') as HTMLInputElement,
    high: screen.getByLabelText('بیشترین قیمت') as HTMLInputElement,
  });

  it('starts at the catalogue’s own ends when no bound is set', () => {
    renderFilters();
    const { low, high } = handles();

    expect(low.value).toBe('50000');
    expect(high.value).toBe('500000');
  });

  it('starts at the URL’s bounds when they are set', () => {
    renderFilters({ minPrice: '100000', maxPrice: '300000' });
    const { low, high } = handles();

    expect(low.value).toBe('100000');
    expect(high.value).toBe('300000');
  });

  // The reason this component has a test at all: state derived from a prop
  // this component itself causes to change. Dragging must not navigate — a
  // push per step would be a navigation storm — and the window in which the
  // handle and the URL disagree exists only at runtime.
  it('does not navigate while a handle is being dragged', () => {
    renderFilters();
    const { low } = handles();

    fireEvent.change(low, { target: { value: '120000' } });
    fireEvent.change(low, { target: { value: '160000' } });

    expect(push).not.toHaveBeenCalled();
  });

  it('navigates once, on release', () => {
    renderFilters();
    const { low } = handles();

    fireEvent.change(low, { target: { value: '160000' } });
    fireEvent.pointerUp(low);

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toContain('minPrice=160000');
  });

  it('commits from the keyboard too, not only the pointer', () => {
    renderFilters();
    const { high } = handles();

    fireEvent.change(high, { target: { value: '200000' } });
    fireEvent.keyUp(high, { key: 'ArrowLeft' });

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toContain('maxPrice=200000');
  });

  it('shows the range it is about to apply while dragging', () => {
    renderFilters();
    const { low } = handles();

    fireEvent.change(low, { target: { value: '160000' } });

    // Persian digits and the separator come from `format.ts`, like every other
    // number on the storefront — the input's own value cannot carry them.
    expect(screen.getByText(/۱۶۰٬۰۰۰/)).toBeTruthy();
  });

  it('never lets the handles cross', () => {
    renderFilters({ minPrice: '100000', maxPrice: '200000' });
    const { low, high } = handles();

    fireEvent.change(low, { target: { value: '400000' } });

    expect(Number(low.value)).toBeLessThan(Number(high.value));
  });

  it('clears a bound left at its end rather than pinning it', () => {
    renderFilters({ minPrice: '100000', maxPrice: '300000' });
    const { low } = handles();

    fireEvent.change(low, { target: { value: String(BOUNDS.min) } });
    fireEvent.pointerUp(low);

    // The shopper dragged it back to the cheapest product, which means «no
    // lower bound» — not `?minPrice=50000`, which would survive every later
    // filter change and quietly hide anything cheaper added afterwards.
    expect(push.mock.calls[0][0]).not.toContain('minPrice');
    expect(push.mock.calls[0][0]).toContain('maxPrice=300000');
  });

  // Every test above moves a handle first, so none of them could catch a
  // release that moved nothing — and `pointerUp`/`keyUp` fire for a bare click
  // on the thumb and for the Tab that lands on it. Both navigated, and inside
  // the mobile sheet both also closed it, which put the price filter out of a
  // keyboard shopper's reach altogether.
  it('does not navigate when a handle is released without moving', () => {
    renderFilters();
    const { low } = handles();

    fireEvent.pointerUp(low);

    expect(push).not.toHaveBeenCalled();
  });

  it('does not navigate when the keyboard merely arrives on a handle', () => {
    renderFilters();
    const { high } = handles();

    fireEvent.keyUp(high, { key: 'Tab' });

    expect(push).not.toHaveBeenCalled();
  });

  it('does not navigate twice when a handle is released back where it started', () => {
    renderFilters({ minPrice: '100000' });
    const { low } = handles();

    fireEvent.change(low, { target: { value: '160000' } });
    fireEvent.change(low, { target: { value: '100000' } });
    fireEvent.pointerUp(low);

    expect(push).not.toHaveBeenCalled();
  });

  it('never shows a negative price, whatever the URL asks for', () => {
    // `?maxPrice=1` is below the catalogue's floor. Clamped on one side each,
    // the two handles arrived crossed and one nudge of the low one rendered
    // «−۹٬۹۹۹ تا ۱» — a negative Toman price, against the money rule.
    renderFilters({ maxPrice: '1' });
    const { low, high } = handles();

    expect(Number(low.value)).toBeGreaterThanOrEqual(BOUNDS.min);
    expect(Number(high.value)).toBeGreaterThan(Number(low.value));

    fireEvent.change(low, { target: { value: '0' } });

    expect(Number(low.value)).toBeGreaterThanOrEqual(BOUNDS.min);
  });

  it('keeps both handles on the track for a URL above the ceiling too', () => {
    renderFilters({ minPrice: '9999999' });
    const { low, high } = handles();

    expect(Number(high.value)).toBeLessThanOrEqual(BOUNDS.max);
    expect(Number(low.value)).toBeLessThan(Number(high.value));
  });

  it('is not rendered when every product costs the same', () => {
    render(
      <ShopFilters
        query={parseShopQuery({})}
        categories={OPTIONS}
        priceBounds={{ min: 90_000, max: 90_000 }}
      />,
    );

    expect(screen.queryByLabelText('کمترین قیمت')).toBeNull();
  });
});
