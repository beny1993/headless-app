'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import Script from 'next/script';

type UmamiPayload = Record<string, unknown>;

declare global {
  interface Window {
    /** Set by the tracker script once it has loaded. */
    umami?: { track: (payload: (props: UmamiPayload) => UmamiPayload) => void };
  }
}

/**
 * Auto-track's own wait before a pageview: Next streams the new page's
 * `<title>` in after the commit, and a pageview sent at once can go out with
 * none.
 */
const PAGEVIEW_WAIT_MS = 300;

/** The page the last pageview counted, and the page that referred it. */
type CountedPage = { url: string; referrer: string | null };

/**
 * Self-hosted Umami, with the tracker's auto-track switched off.
 *
 * Auto-track hijacks links. Its capture-phase click listener calls
 * `preventDefault()` on every `<a data-umami-event>`, waits for the beacon,
 * then assigns `location.href` — and `<Link>` stands down on a prevented click.
 * Every tracked link on the site (a variant chip, a product card, a
 * breadcrumb) was a full page load queued behind an analytics round trip.
 *
 * So this does auto-track's two jobs without touching the click: a pageview
 * per URL, an event per tracked click. Both stamp the URL themselves: with
 * auto-track off the tracker never hears about a client-side navigation and
 * would file everything under the landing page.
 *
 * ponytail: `data-umami-event-*` extra data is not forwarded — nothing sets
 * any. Collect those attributes in `onClick` the day something does.
 *
 * Reads `useSearchParams`: render it inside `<Suspense>`, or a static page
 * fails `next build`.
 */
export function UmamiTracker({
  src,
  websiteId,
}: {
  src: string;
  websiteId: string;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const counted = useRef<CountedPage | null>(null);

  // A search-only change is a new page too, as it was under auto-track.
  useEffect(() => {
    const timer = setTimeout(() => trackPageview(counted), PAGEVIEW_WAIT_MS);
    return () => clearTimeout(timer);
  }, [pathname, search]);

  useEffect(() => {
    // Capture phase, so the event is filed under the page the click happened
    // on, before any navigation it starts.
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const name = trackedEventOf(event.target);
      if (!name) return;
      const url = window.location.href;
      // Referred like its page, as auto-track's events were. A page still in
      // its pageview wait is referred by the one counted before it.
      const page = counted.current;
      const referrer = page && (page.url === url ? page.referrer : page.url);
      window.umami?.track((props) => ({
        ...props,
        url,
        name,
        ...(referrer && { referrer }),
      }));
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  return (
    <Script
      src={src}
      data-website-id={websiteId}
      data-auto-track="false"
      // The landing pageview, if the effect's came due before the script did.
      onLoad={() => trackPageview(counted)}
    />
  );
}

/**
 * The event a click on `target` sends, if any. The tracker's own rule, so the
 * dashboards read as they did under auto-track: the name on the nearest link
 * or button, else on the element clicked — never a container's. So the name
 * goes on the `<a>` or `<button>` whenever a tap can land inside one; on the
 * form control itself when a `<label>` wraps or points at it, since the label
 * forwards its click there; otherwise on the exact element tapped.
 */
export function trackedEventOf(target: Element): string | null {
  return (target.closest('a,button') ?? target).getAttribute(
    'data-umami-event',
  );
}

/**
 * One pageview for the current URL, referred by the last one counted. A URL
 * already counted is skipped, like the tracker's own history hook skips one.
 */
function trackPageview(counted: RefObject<CountedPage | null>) {
  const url = window.location.href;
  if (!window.umami || url === counted.current?.url) return;

  // The first pageview keeps the tracker's referrer: where the visitor came from.
  const referrer = counted.current?.url ?? null;
  counted.current = { url, referrer };
  window.umami.track((props) => ({
    ...props,
    url,
    ...(referrer && { referrer }),
  }));
}
