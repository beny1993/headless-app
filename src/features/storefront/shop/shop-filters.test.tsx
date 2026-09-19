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
import {
  ShopFilterSheet,
  ShopFilters,
  type ShopCategoryOption,
} from './shop-filters';
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

describe('the mobile sheet\u2019s badge', () => {
  const openButton = () => screen.getByRole('button', { name: /فیلتر/ });
  const renderSheet = (search: Record<string, string> = {}) =>
    render(
      <ShopFilterSheet
        query={parseShopQuery(search)}
        categories={OPTIONS}
        priceBounds={BOUNDS}
        total={7}
      />,
    );

  it('counts a price range once, like the chip behind it', () => {
    renderSheet({ minPrice: '100000', maxPrice: '300000' });

    // «فیلتر (۲)» opening onto one chip is the badge disagreeing with the
    // panel it opens.
    expect(openButton().textContent).toContain('(۱)');
  });

  it('counts the three groups the chips show', () => {
    renderSheet({ category: 'hygiene', pet: 'cat', maxPrice: '300000' });

    expect(openButton().textContent).toContain('(۳)');
  });

  it('shows no number when nothing is filtering', () => {
    renderSheet();

    expect(openButton().textContent).not.toContain('(');
  });
});

describe('the active-filter chips', () => {
  const chips = () =>
    screen
      .getAllByRole('button', { name: /^حذف فیلتر / })
      .map((button) => button.getAttribute('aria-label'));

  it('renders nothing at all when nothing is filtering', () => {
    renderFilters();

    expect(screen.queryByText('فیلترهای فعال')).toBeNull();
  });

  it('names each filter, so three of them are not three identical controls', () => {
    renderFilters({ category: 'hygiene', pet: 'cat', minPrice: '100000' });

    // The `aria-label` is the assertion: a screen reader reading three «remove»
    // buttons in a row hears the same word three times.
    expect(chips()).toEqual([
      'حذف فیلتر بهداشت',
      'حذف فیلتر گربه',
      'حذف فیلتر از ۱۰۰٬۰۰۰',
    ]);
  });

  it('falls back to the slug for a category the page does not know', () => {
    renderFilters({ category: 'gone-since' });

    expect(chips()).toEqual(['حذف فیلتر gone-since']);
  });

  it('words the price chip for each of its three shapes', () => {
    renderFilters({ minPrice: '100000', maxPrice: '300000' });
    expect(chips()).toEqual(['حذف فیلتر ۱۰۰٬۰۰۰ تا ۳۰۰٬۰۰۰']);
    cleanup();

    renderFilters({ maxPrice: '300000' });
    expect(chips()).toEqual(['حذف فیلتر تا ۳۰۰٬۰۰۰']);
    cleanup();

    renderFilters({ minPrice: '100000' });
    expect(chips()).toEqual(['حذف فیلتر از ۱۰۰٬۰۰۰']);
  });

  it('shows one chip for a price range, not one per bound', () => {
    renderFilters({ minPrice: '100000', maxPrice: '300000' });

    expect(chips()).toHaveLength(1);
  });

  it('drops exactly its own filter and leaves the rest alone', () => {
    renderFilters({ category: 'hygiene', pet: 'cat', minPrice: '100000' });

    fireEvent.click(screen.getByRole('button', { name: 'حذف فیلتر گربه' }));

    const href = push.mock.calls[0][0] as string;
    expect(href).not.toContain('pet=');
    expect(href).toContain('category=hygiene');
    expect(href).toContain('minPrice=100000');
  });

  it('drops both price bounds together, since it is one chip', () => {
    renderFilters({ minPrice: '100000', maxPrice: '300000' });

    fireEvent.click(
      screen.getByRole('button', { name: 'حذف فیلتر ۱۰۰٬۰۰۰ تا ۳۰۰٬۰۰۰' }),
    );

    const href = push.mock.calls[0][0] as string;
    expect(href).not.toContain('minPrice');
    expect(href).not.toContain('maxPrice');
  });
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

  // The third of the repo's three reasons a component gets a test: a control
  // that writes the URL and reads it back. The handles are local state, so
  // between a drag and the navigation that follows it they and the URL
  // disagree — and if a *different* URL arrives in that window (the back
  // button, a chip dropping the price filter, «پاک کردن همه»), the stale
  // handles would outlive it.
  it('takes the URL’s bounds back after a change it did not make', () => {
    const { rerender } = renderFilters({
      minPrice: '100000',
      maxPrice: '300000',
    });
    fireEvent.change(handles().low, { target: { value: '200000' } });
    expect(handles().low.value).toBe('200000');

    rerender(
      <ShopFilters
        query={parseShopQuery({})}
        categories={OPTIONS}
        priceBounds={BOUNDS}
      />,
    );

    expect(handles().low.value).toBe(String(BOUNDS.min));
    expect(handles().high.value).toBe(String(BOUNDS.max));
  });

  it('rounds the offered ends outwards from the catalogue\u2019s own', () => {
    // Every `BOUNDS` above is a clean multiple of the step, so nothing here
    // exercised the rounding: the floor has to go *down* to a step and the
    // ceiling *up*, or the cheapest and dearest products fall outside the
    // range the slider can express.
    render(
      <ShopFilters
        query={parseShopQuery({})}
        categories={OPTIONS}
        priceBounds={{ min: 55_000, max: 494_000 }}
      />,
    );

    expect(handles().low.min).toBe('50000');
    expect(handles().high.max).toBe('500000');
  });

  it('stops the high handle a step above the low one too', () => {
    // The mirror of the crossing test above, which only ever moved the low
    // handle — so `setHigh`'s clamp could be deleted and stay green.
    renderFilters({ minPrice: '200000', maxPrice: '300000' });

    fireEvent.change(handles().high, { target: { value: '60000' } });

    expect(Number(handles().high.value)).toBeGreaterThan(
      Number(handles().low.value),
    );
  });

  it('takes new catalogue ends back, not just new bounds', () => {
    // The resync key has to carry the track as well as the handles: a
    // catalogue whose cheapest product changed moves the ends the handles are
    // positioned against, and the URL's own bounds may not have changed at all.
    const { rerender } = renderFilters();
    expect(handles().low.value).toBe(String(BOUNDS.min));

    rerender(
      <ShopFilters
        query={parseShopQuery({})}
        categories={OPTIONS}
        priceBounds={{ min: 120_000, max: 500_000 }}
      />,
    );

    expect(handles().low.value).toBe('120000');
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
