// Pins the analytics wiring that replaced Umami's auto-track.
//
// Auto-track turned every `<a data-umami-event>` into a full page load: the
// tracker's own click listener calls `preventDefault()`, waits for its beacon,
// then assigns `location.href`, and `<Link>` stands down on a prevented click.
// Picking a product's variant reloaded the whole page. So the tracker loads
// with auto-track off, and this component does its two jobs — a pageview per
// URL, an event per tracked click — without ever touching the click.
//
// The edges are mocked, nothing else: `next/script` records its props and
// hands the test the load callback, `next/navigation` reports whatever URL the
// test moved to, and `window.umami` is a recorder. Each recorded call is fed a
// stale payload, the way the real tracker would, to read what would be sent.
import { act, StrictMode } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsUrl, UmamiTracker } from './umami-tracker';

const { script } = vi.hoisted(() => ({
  script: { props: {} as Record<string, unknown> },
}));
vi.mock('next/script', () => ({
  default: (props: Record<string, unknown>) => {
    script.props = props;
    return null;
  },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

/** What the tracker itself would put in a payload, landing URL and all. */
const STALE = {
  website: 'site',
  url: 'stale',
  referrer: 'https://google.com/',
};
/** `document.title` at each send: the tracker reads the title right then. */
const titles: string[] = [];
const track = vi.fn<NonNullable<Window['umami']>['track']>(() => {
  titles.push(document.title);
});
/** Every payload sent so far, as the tracker would have built it. */
const sent = (stale: Record<string, unknown> = STALE) =>
  track.mock.calls.map(([payload]) => payload(stale));

const origin = () => window.location.origin;
const moveTo = (path: string) => window.history.pushState(null, '', path);
/** The component's own wait before a pageview. A change to it is a change in behaviour. */
const PAGEVIEW_WAIT_MS = 300;
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

function renderTracker() {
  const element = () => (
    <UmamiTracker src="https://a.test/s.js" websiteId="w" />
  );
  const view = render(<StrictMode>{element()}</StrictMode>);
  return {
    /** The script finishes loading: `window.umami` exists from here on. */
    load: () => {
      window.umami = { track };
      (script.props.onLoad as () => void)();
    },
    /** A client-side navigation lands: the URL moves, the tree re-renders. */
    navigate: (path: string) => {
      moveTo(path);
      view.rerender(<StrictMode>{element()}</StrictMode>);
    },
    unmount: view.unmount,
  };
}

/** A tracked link as the storefront renders one. */
function trackedLink(event: string, href = '/product/other') {
  const link = document.createElement('a');
  link.href = href;
  link.dataset.umamiEvent = event;
  link.append(document.createElement('span'));
  document.body.append(link);
  return link;
}

/** Whether anything before the page's own handlers cancelled the click. */
function clickAndReadPrevented(target: Element) {
  let prevented: boolean | undefined;
  const read = (event: Event) => {
    prevented = event.defaultPrevented;
    // Stops happy-dom from following the link once the answer is read.
    event.preventDefault();
  };
  window.addEventListener('click', read);
  fireEvent.click(target);
  window.removeEventListener('click', read);
  return prevented;
}

beforeEach(() => {
  moveTo('/product/first');
  // Only the pageview wait; faking React's own scheduling as well is how a
  // suite like this starts flaking.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.replaceChildren();
  document.title = '';
  delete window.umami;
  track.mockClear();
  titles.length = 0;
  script.props = {};
});

describe('the Umami tracker', () => {
  it('loads the script with its link-hijacking auto-track switched off', () => {
    renderTracker();

    expect(script.props).toMatchObject({
      src: 'https://a.test/s.js',
      'data-website-id': 'w',
      'data-auto-track': 'false',
    });
  });

  it('counts the landing page once the script has loaded, however late', () => {
    const tracker = renderTracker();
    // The wait comes due before the script arrives, as on any visit where the
    // self-hosted script takes longer. It must not use the landing URL up, or
    // the load below would skip the landing pageview.
    wait(PAGEVIEW_WAIT_MS);

    tracker.load();

    // The page's own URL; the referrer is left to the tracker, which knows
    // where the visitor came from.
    expect(sent()).toEqual([{ ...STALE, url: `${origin()}/product/first` }]);
  });

  it('counts a client-side navigation with the page it came from', () => {
    const tracker = renderTracker();
    tracker.load();

    tracker.navigate('/shop');
    wait(PAGEVIEW_WAIT_MS);
    // Only the query moves — the shop's search box and filters do this.
    tracker.navigate('/shop?q=%DA%AF%D8%B1%D8%A8%D9%87');
    wait(PAGEVIEW_WAIT_MS);

    expect(sent().slice(1)).toEqual([
      {
        ...STALE,
        url: `${origin()}/shop`,
        referrer: `${origin()}/product/first`,
      },
      {
        ...STALE,
        url: `${origin()}/shop?q=%DA%AF%D8%B1%D8%A8%D9%87`,
        referrer: `${origin()}/shop`,
      },
    ]);
  });

  it('waits for the title Next streams in behind the page', () => {
    document.title = 'first';
    const tracker = renderTracker();
    tracker.load();

    // The old title goes as the new page commits; the new one lands after it.
    document.title = '';
    tracker.navigate('/product/second');
    wait(100);
    document.title = 'second';
    wait(PAGEVIEW_WAIT_MS - 100);

    expect(titles).toEqual(['first', 'second']);
  });

  it('counts each URL once however often it is told', () => {
    const tracker = renderTracker();
    tracker.load();
    tracker.load();
    // The mount's own pageview comes due after the load already counted it.
    wait(PAGEVIEW_WAIT_MS);

    expect(track).toHaveBeenCalledTimes(1);
  });

  it('sends a tracked click as an event and leaves the click to the page', () => {
    const tracker = renderTracker();
    tracker.load();
    const link = trackedLink('product-variant-open');

    // On the link's own child, as a real tap lands.
    const prevented = clickAndReadPrevented(link.firstElementChild!);

    expect(prevented).toBe(false);
    expect(sent().slice(1)).toEqual([
      {
        ...STALE,
        url: `${origin()}/product/first`,
        name: 'product-variant-open',
      },
    ]);
  });

  it('counts what auto-track counted: the nearest link or button, else the element', () => {
    const tracker = renderTracker();
    tracker.load();
    // A tracked container: a list, a wrapper, a `<label>` round an input.
    // Counting every click inside one would fire a label twice per click —
    // once for itself, once for the input it forwards the click to.
    const container = document.createElement('div');
    container.dataset.umamiEvent = 'container';
    const untrackedLink = document.createElement('a');
    untrackedLink.href = '/elsewhere';
    const child = document.createElement('span');
    container.append(untrackedLink, child);
    // A tracked button wrapping an icon, as every admin save and delete does.
    const button = document.createElement('button');
    button.dataset.umamiEvent = 'button';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    button.append(icon);
    document.body.append(container, button);

    clickAndReadPrevented(untrackedLink);
    clickAndReadPrevented(child);
    clickAndReadPrevented(container);
    clickAndReadPrevented(icon);

    expect(sent().slice(1)).toEqual([
      { ...STALE, url: `${origin()}/product/first`, name: 'container' },
      { ...STALE, url: `${origin()}/product/first`, name: 'button' },
    ]);
  });

  it('refers a click like the page it happened on, even inside its wait', () => {
    const tracker = renderTracker();
    tracker.load();

    tracker.navigate('/shop');
    // Inside the wait /shop is not counted yet, but the landing page refers it.
    clickAndReadPrevented(trackedLink('inside-the-wait'));
    wait(PAGEVIEW_WAIT_MS);
    clickAndReadPrevented(trackedLink('after-the-wait'));

    const referred = {
      ...STALE,
      url: `${origin()}/shop`,
      referrer: `${origin()}/product/first`,
    };
    expect(sent().filter((payload) => 'name' in payload)).toEqual([
      { ...referred, name: 'inside-the-wait' },
      { ...referred, name: 'after-the-wait' },
    ]);
  });

  it('ignores untracked clicks, clicks before the load and after unmount', () => {
    const tracker = renderTracker();
    const early = trackedLink('too-early');
    expect(() => clickAndReadPrevented(early)).not.toThrow();

    tracker.load();
    const button = document.createElement('button');
    document.body.append(button);
    clickAndReadPrevented(button);

    tracker.unmount();
    clickAndReadPrevented(trackedLink('after-unmount'));

    // The landing pageview, and nothing else.
    expect(track).toHaveBeenCalledTimes(1);
  });
});

// The users search is a GET form, so an admin URL can carry a customer's phone
// number (`?q=0912…`), and the Umami instance is shared by every project. An
// admin URL goes out without its query; the storefront's are left alone.
describe('the Umami tracker in the admin panel', () => {
  const SEARCH = '/admin-panel/users?q=09121234567';
  // Another admin search than the page's own, so a referrer taken from the
  // wrong place (the page itself) cannot pass for the right one once stripped.
  const adminStale = {
    ...STALE,
    referrer: `${origin()}/admin-panel/orders?q=09121234567`,
  };

  it('sends admin pageviews and their referrers without the query', () => {
    moveTo(SEARCH);
    const tracker = renderTracker();
    tracker.load();
    tracker.navigate('/admin-panel/users/abc123');
    wait(PAGEVIEW_WAIT_MS);

    expect(sent(adminStale)).toEqual([
      // The landing page, referred by the tracker's own `document.referrer`.
      {
        ...adminStale,
        url: `${origin()}/admin-panel/users`,
        referrer: `${origin()}/admin-panel/orders`,
      },
      {
        ...adminStale,
        url: `${origin()}/admin-panel/users/abc123`,
        referrer: `${origin()}/admin-panel/users`,
      },
    ]);
    expect(JSON.stringify(sent(adminStale))).not.toContain('0912');
  });

  it('sends an admin click without the query', () => {
    moveTo(SEARCH);
    const tracker = renderTracker();
    tracker.load();

    clickAndReadPrevented(trackedLink('admin-panel-users-view'));

    expect(sent(adminStale).slice(1)).toEqual([
      {
        ...adminStale,
        url: `${origin()}/admin-panel/users`,
        name: 'admin-panel-users-view',
        referrer: `${origin()}/admin-panel/orders`,
      },
    ]);
  });

  it('still counts each admin URL, query changes included', () => {
    moveTo('/admin-panel/orders');
    const tracker = renderTracker();
    tracker.load();
    tracker.navigate('/admin-panel/orders?page=2');
    wait(PAGEVIEW_WAIT_MS);

    expect(sent().map((payload) => payload.url)).toEqual([
      `${origin()}/admin-panel/orders`,
      `${origin()}/admin-panel/orders`,
    ]);
  });

  it('leaves a storefront search, and its referrer, as they are', () => {
    const shopSearch = `${origin()}/shop?q=%DA%AF%D8%B1%D8%A8%D9%87`;
    moveTo('/shop?q=%DA%AF%D8%B1%D8%A8%D9%87');
    const tracker = renderTracker();
    tracker.load();
    clickAndReadPrevented(trackedLink('shop-search-submit'));

    const stale = { ...STALE, referrer: shopSearch };
    expect(sent(stale)).toEqual([
      { ...stale, url: shopSearch },
      { ...stale, url: shopSearch, name: 'shop-search-submit' },
    ]);
  });
});

describe('analyticsUrl', () => {
  it.each([
    ['/admin-panel?page=2', '/admin-panel'],
    ['/admin-panel/users?q=0912#top', '/admin-panel/users#top'],
    ['/admin-panel/users/abc', '/admin-panel/users/abc'],
  ])('strips the query from our admin URL %s', (path, expected) => {
    expect(analyticsUrl(`${origin()}${path}`)).toBe(`${origin()}${expected}`);
  });

  it.each([
    [`/shop?q=0912`],
    [`/admin-panel-archive?q=0912`],
    [`/admin-panelx?q=0912`],
  ])('leaves %s alone', (path) => {
    expect(analyticsUrl(`${origin()}${path}`)).toBe(`${origin()}${path}`);
  });

  it.each([
    ['another site', 'https://example.test/admin-panel?q=1'],
    ['something that is not a URL', 'not a url'],
    ['blank', ''],
  ])('leaves %s alone', (_label, url) => {
    expect(analyticsUrl(url)).toBe(url);
  });
});
