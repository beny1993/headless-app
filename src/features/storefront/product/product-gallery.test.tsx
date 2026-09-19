// Pins the gallery's state sync: `active` follows the SWIPE, and the thumbnail
// strip follows `active`.
//
// Why a component test: the active photo is state this component derives from
// something it also causes — a thumb click scrolls the track, the track's
// scrolling is what moves the observer, and the observer is what sets the
// state. No unit test can reach that loop, and the bug it guards against is a
// strip that reports the photo the visitor *clicked* while the track is
// showing the one they *swiped* to.
//
// The platform edge is mocked rather than the logic: happy-dom's
// `IntersectionObserver.observe()` is a literal no-op (its source says
// «TODO: Implement»), so nothing would ever fire on its own. The stub captures
// the real callback the component registered and hands it synthetic entries —
// which is what a browser does after a scroll settles. A real swipe is
// Playwright's job.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductGallery, type GalleryImage } from './product-gallery';

const IMAGES: GalleryImage[] = [
  { id: 'a', objectKey: 'uploads/a.jpg' },
  { id: 'b', objectKey: 'uploads/b.jpg' },
  { id: 'c', objectKey: 'uploads/c.jpg' },
];

/** The callback the component handed `new IntersectionObserver(...)`. */
let notify: ((entries: IntersectionObserverEntry[]) => void) | null = null;
/** Every element the component asked to observe. */
let observed: Element[] = [];

beforeEach(() => {
  notify = null;
  observed = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
        notify = callback;
      }
      observe(target: Element) {
        observed.push(target);
      }
      disconnect() {}
      unobserve() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * What a browser reports once a scroll settles on the slide at `index`. Inside
 * `act` because a real observer callback arrives from outside React and the
 * state it sets has to be flushed before the next assertion.
 */
const settleOn = (index: number) =>
  act(() => {
    notify?.([
      {
        isIntersecting: true,
        target: observed[index],
      } as unknown as IntersectionObserverEntry,
    ]);
  });

const thumbs = () =>
  screen
    .getAllByRole('button', { name: /^نمایش تصویر/ })
    .map((thumb) => thumb.getAttribute('aria-pressed'));

describe('the strip follows the swipe', () => {
  it('opens on the first photo', () => {
    render(<ProductGallery images={IMAGES} title="غذای گربه" />);

    expect(thumbs()).toEqual(['true', 'false', 'false']);
    expect(observed).toHaveLength(3);
  });

  it('moves `aria-pressed` to the photo the visitor swiped to', () => {
    render(<ProductGallery images={IMAGES} title="غذای گربه" />);

    settleOn(2);

    // The pin: nothing was clicked. The strip knows only because the observer
    // told it, which is the whole point of the observer being the one source
    // of truth — a swipe and a click can never disagree.
    expect(thumbs()).toEqual(['false', 'false', 'true']);
  });

  it('a thumb click scrolls the track and does not set the index itself', () => {
    const scrollBy = vi
      .spyOn(Element.prototype, 'scrollBy')
      .mockImplementation(() => {});
    render(<ProductGallery images={IMAGES} title="غذای گربه" />);

    fireEvent.click(screen.getByRole('button', { name: 'نمایش تصویر ۲' }));

    expect(scrollBy).toHaveBeenCalledTimes(1);
    // Still on the first photo: the click asked the track to move, and only
    // the observer reporting where it landed may change what the strip says.
    expect(thumbs()).toEqual(['true', 'false', 'false']);

    settleOn(1);
    expect(thumbs()).toEqual(['false', 'true', 'false']);
  });

  it('never passes `behavior`, so CSS scroll-smooth and reduced motion govern', () => {
    const scrollBy = vi
      .spyOn(Element.prototype, 'scrollBy')
      .mockImplementation(() => {});
    render(<ProductGallery images={IMAGES} title="غذای گربه" />);

    fireEvent.click(screen.getByRole('button', { name: 'نمایش تصویر ۳' }));

    expect(scrollBy.mock.calls[0][0]).not.toHaveProperty('behavior');
  });

  it('ignores a slide leaving the viewport', () => {
    render(<ProductGallery images={IMAGES} title="غذای گربه" />);
    settleOn(1);

    act(() => {
      notify?.([
        {
          isIntersecting: false,
          target: observed[0],
        } as unknown as IntersectionObserverEntry,
      ]);
    });

    expect(thumbs()).toEqual(['false', 'true', 'false']);
  });
});

describe('what the gallery renders', () => {
  it('names the track and numbers every photo after the first', () => {
    render(<ProductGallery images={IMAGES} title="غذای گربه" />);

    expect(
      screen.getByRole('list', { name: 'گالری تصاویر محصول' }),
    ).toBeTruthy();
    expect(screen.getByAltText('غذای گربه')).toBeTruthy();
    expect(screen.getByAltText('تصویر ۲ از غذای گربه')).toBeTruthy();
    expect(screen.getByAltText('تصویر ۳ از غذای گربه')).toBeTruthy();
  });

  it('renders the track but no strip for a single photo', () => {
    render(<ProductGallery images={[IMAGES[0]]} title="غذای گربه" />);

    expect(
      screen.getByRole('list', { name: 'گالری تصاویر محصول' }),
    ).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: /^نمایش تصویر/ })).toEqual(
      [],
    );
  });

  it('shows the placeholder and no track for a product with no photo', () => {
    render(<ProductGallery images={[]} title="غذای گربه" />);

    expect(
      screen.queryByRole('list', { name: 'گالری تصاویر محصول' }),
    ).toBeNull();
  });
});
