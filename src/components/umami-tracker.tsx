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
  const lastUrl = useRef<string | null>(null);

  // A search-only change is a new page too, as it was under auto-track. So is
  // the wait, which is auto-track's own: Next streams the new page's `<title>`
  // in after the commit, and a pageview sent at once can go out with none.
  useEffect(() => {
    const timer = setTimeout(() => trackPageview(lastUrl), 300);
    return () => clearTimeout(timer);
  }, [pathname, search]);

  useEffect(() => {
    // Capture phase, so the event is filed under the page the click happened
    // on, before any navigation it starts.
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const name = trackedEventOf(event.target);
      if (name) {
        const url = window.location.href;
        window.umami?.track((props) => ({ ...props, url, name }));
      }
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
      onLoad={() => trackPageview(lastUrl)}
    />
  );
}

/**
 * The event a click on `target` sends, if any. The tracker's own rule, so the
 * dashboards read as they did under auto-track: the name on the nearest link
 * or button, else on the element clicked — never a container's. So a tracked
 * non-link has to carry its name on what a tap actually lands on.
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
function trackPageview(lastUrl: RefObject<string | null>) {
  const url = window.location.href;
  if (!window.umami || url === lastUrl.current) return;

  // The first pageview keeps the tracker's referrer: where the visitor came from.
  const referrer = lastUrl.current;
  lastUrl.current = url;
  window.umami.track((props) => ({
    ...props,
    url,
    ...(referrer && { referrer }),
  }));
}
