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
let options: IntersectionObserverInit | null = null;

beforeEach(() => {
  notify = null;
  observed = [];
  options = null;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(
        callback: (entries: IntersectionObserverEntry[]) => void,
        init?: IntersectionObserverInit,
      ) {
        notify = callback;
        // Captured so the threshold and root can be asserted: they decide
        // which photo the strip reports mid-gesture, and nothing else pins
        // them.
        options = init ?? null;
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
const entry = (index: number, intersectionRatio: number) =>
  ({
    isIntersecting: intersectionRatio > 0,
    intersectionRatio,
    target: observed[index],
  }) as unknown as IntersectionObserverEntry;

/**
 * Deliver a batch the way a browser does — **every** target that crossed in
 * the same pass, in registration order, each with its ratio. A stub that hands
 * over one hand-picked entry cannot see a callback that takes the last one it
 * is given rather than the one most on screen.
 */
const report = (...entries: IntersectionObserverEntry[]) =>
  act(() => {
    notify?.(entries);
  });

/** What a browser reports once a scroll settles on the slide at `index`. */
const settleOn = (index: number) => report(entry(index, 1));

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

describe('the snap suspension', () => {
  const track = () => document.querySelector('ul') as HTMLUListElement;

  it('turns snapping off for the jump and back on once it settles', () => {
    render(<ProductGallery images={IMAGES} title="غذای گربه" />);
    let duringJump = '';
    vi.spyOn(Element.prototype, 'scrollBy').mockImplementation(function (
      this: Element,
    ) {
      duringJump = (this as HTMLElement).style.scrollSnapType;
    });

    fireEvent.click(screen.getAllByRole('button', { name: /^نمایش تصویر/ })[2]);

    // Off while the jump is in flight: `scroll-snap-stop: always` refuses to
    // let any scroll pass a snap point, so a two-slide jump would land short.
    expect(duringJump).toBe('none');
    fireEvent(track(), new Event('scrollend'));
    expect(track().style.scrollSnapType).toBe('');
  });

  it('restores snapping even when the jump scrolls nowhere', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<ProductGallery images={IMAGES} title="غذای گربه" />);
    vi.spyOn(Element.prototype, 'scrollBy').mockImplementation(() => {});

    // Tapping the thumb of the photo already showing computes a zero delta,
    // nothing scrolls, and no `scrollend` ever arrives. Without the timer the
    // track would sit unsnapped and a swipe could park between two photos.
    fireEvent.click(screen.getAllByRole('button', { name: /^نمایش تصویر/ })[0]);
    expect(track().style.scrollSnapType).toBe('none');
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(track().style.scrollSnapType).toBe('');
    vi.useRealTimers();
  });

  it('does not let an earlier jump restore snapping mid-flight', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<ProductGallery images={IMAGES} title="غذای گربه" />);
    vi.spyOn(Element.prototype, 'scrollBy').mockImplementation(() => {});
    const thumbs = screen.getAllByRole('button', { name: /^نمایش تصویر/ });

    fireEvent.click(thumbs[2]);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // A second tap before the first timer fires. If the first one survived, it
    // would re-snap the track 100ms into this jump.
    fireEvent.click(thumbs[0]);
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(track().style.scrollSnapType).toBe('none');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(track().style.scrollSnapType).toBe('');
    vi.useRealTimers();
  });
});

describe('which slide the observer reports', () => {
  it('takes the slide most on screen, not the last one reported', () => {
    render(<ProductGallery images={IMAGES} title="غذای گربه" />);
    settleOn(0);

    // A real batch on a flick: the slide being left still overlaps, and
    // `isIntersecting` is true for any overlap at all. Registration order puts
    // the leaver last, so taking the last entry would follow it backwards.
    report(entry(1, 0.95), entry(0, 0.65));

    expect(thumbs()).toEqual(['false', 'true', 'false']);
  });

  it('ignores a batch where nothing is showing enough', () => {
    render(<ProductGallery images={IMAGES} title="غذای گربه" />);
    settleOn(1);

    // Parked between two photos: neither clears the bar, so the strip keeps
    // what it had rather than guessing.
    report(entry(1, 0.5), entry(2, 0.5));

    expect(thumbs()).toEqual(['false', 'true', 'false']);
  });

  it('roots the observer on the track and asks for the ratio it uses', () => {
    render(<ProductGallery images={IMAGES} title="غذای گربه" />);

    expect(options?.root).toBe(document.querySelector('ul'));
    expect(options?.threshold).toBe(0.6);
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
