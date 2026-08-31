// Pins the search box's resync rule: re-sync the box **only** when the URL
// moves to a value this component did not push.
//
// The bug that shipped collapsed `seenUrl` and `pushed` into one variable, and
// the primary flow of the shop broke in a way no unit test could see: the
// moment the debounce fired, the box wiped itself to empty and refilled from
// the URL a request later, eating everything typed in between. `shop-query.ts`
// is pure and fully tested; the defect lived entirely in the wiring between it
// and React.
//
// The round trip is simulated the way Next actually performs it: `push` records
// an href and changes nothing, and the test decides when the server component
// re-renders with the new `searchParams` — parsed by the real `parseShopQuery`,
// so the box is handed back exactly what `/shop` would hand it back, trim and
// all. Nothing about the resync itself is mocked.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShopSearch } from './shop-search';
import { parseShopQuery } from './shop-query';

/** The component's own wait. A change to it is a change in behaviour. */
const DEBOUNCE_MS = 350;

const { push } = vi.hoisted(() => ({ push: vi.fn<(href: string) => void>() }));
// The box uses exactly one thing from the router, and this is it.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

function renderSearch() {
  const view = render(<ShopSearch query={parseShopQuery({})} />);
  const box = () => screen.getByRole('searchbox') as HTMLInputElement;

  return {
    value: () => box().value,
    type: (text: string) =>
      fireEvent.change(box(), { target: { value: text } }),
    submit: () => fireEvent.submit(screen.getByRole('search')),
    /** Waits out the debounce, so any pending push happens now. */
    waitOutDebounce: () =>
      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS);
      }),
    /** The navigation lands: `/shop` re-renders the box with the new query. */
    land: (href: string) =>
      view.rerender(
        <ShopSearch
          query={parseShopQuery(new URL(href, 'http://shop.test').searchParams)}
        />,
      ),
  };
}

beforeEach(() => {
  // Only the debounce. Faking React 19's own scheduling as well makes the
  // renders below depend on timer order, which is how this suite would start
  // flaking.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  push.mockReset();
});

describe('the shop search box', () => {
  it('keeps the typed term when its own navigation starts', () => {
    const search = renderSearch();
    search.type('گربه');

    search.waitOutDebounce();

    expect(push).toHaveBeenCalledWith('/shop?q=%DA%AF%D8%B1%D8%A8%D9%87');
    // The push is in flight and the URL still says nothing. The box is not the
    // URL's echo — it holds what the shopper typed.
    expect(search.value()).toBe('گربه');
  });

  it('keeps characters typed while its own navigation is in flight', () => {
    const search = renderSearch();
    search.type('گربه');
    search.waitOutDebounce();

    // The shopper carries on typing during the round trip.
    search.type('گربه بازی');
    // …and only then does the earlier navigation land.
    search.land(push.mock.calls[0][0]);

    expect(search.value()).toBe('گربه بازی');
  });

  it('leaves the box alone when its own pushed URL lands', () => {
    const search = renderSearch();
    search.type('گربه');
    search.waitOutDebounce();

    search.land(push.mock.calls[0][0]);

    expect(search.value()).toBe('گربه');
    // Landing is not a new search: nothing more is pushed.
    search.waitOutDebounce();
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('does not read a trailing space as somebody else’s navigation', () => {
    const search = renderSearch();
    // Two Persian words being typed — the space is mid-thought, not noise.
    search.type('غذای گربه ');
    search.waitOutDebounce();

    // `/shop` trims `q`, so the URL can never hand this term back as it was
    // sent. The box must not mistake its own trimmed term for a foreign one.
    search.land(push.mock.calls[0][0]);

    expect(search.value()).toBe('غذای گربه ');
  });

  it('follows the URL when the move came from somewhere else', () => {
    const search = renderSearch();
    search.type('گربه');
    search.waitOutDebounce();
    search.land(push.mock.calls[0][0]);

    // The back button, a shared link, the empty state's clear-search link.
    search.land('/shop?q=%D8%B3%DA%AF');

    expect(search.value()).toBe('سگ');
  });

  it('costs one history entry when Enter races the debounce', () => {
    const search = renderSearch();
    search.type('گربه');

    // Enter, before the debounce has run.
    search.submit();
    expect(push).toHaveBeenCalledTimes(1);

    // The pending timer must not push the same href a second time — that costs
    // the shopper two presses of the back button.
    search.waitOutDebounce();
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('costs no history entry when Enter repeats the search already on screen', () => {
    const search = renderSearch();
    search.type('گربه');
    search.waitOutDebounce();
    search.land(push.mock.calls[0][0]);

    // Nothing has changed since; a shopper pressing Enter again is asking for
    // the page they are already looking at.
    search.submit();

    expect(push).toHaveBeenCalledTimes(1);
  });
});
