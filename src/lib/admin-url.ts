// An admin URL as it may leave the app. The users search is a GET form, so an
// admin page's `?q=` can hold a customer's phone number or name, and the two
// services that see page URLs are third parties: the Umami instance shared by
// every project, and the hosted error tracker. Both send URLs through this.
//
// Client-safe and dependency-free: the tracker runs in the browser, and the
// Sentry options are shared by the browser, Node and edge runtimes.
import { PROTECTED_PATHS } from '@/lib/constant/paths';

/** Resolves a path-relative URL; never a real host. */
const RELATIVE_BASE = 'http://relative.invalid';

const parse = (url: string, base?: string): URL | null => {
  try {
    return new URL(url, base);
  } catch {
    return null;
  }
};

const isAdminPath = (pathname: string) =>
  pathname === PROTECTED_PATHS.INDEX ||
  pathname.startsWith(`${PROTECTED_PATHS.INDEX}/`);

/**
 * `url` without its query string when it is one of our admin pages, else `url`
 * unchanged. Absolute URLs count as ours at `origin`, or at any origin when none
 * is given (the error tracker only holds this app's URLs, and over-stripping
 * there costs nothing); a relative one only as a path on this site, never a
 * protocol-relative `//other-host/…`. The hash is kept.
 */
export function stripAdminQuery(url: string, origin?: string): string {
  const absolute = parse(url);
  const parsed = absolute ?? parse(url, RELATIVE_BASE);
  if (!parsed) return url;
  const ours = absolute
    ? origin === undefined || parsed.origin === origin
    : parsed.origin === RELATIVE_BASE && url.startsWith('/');
  if (!ours || !isAdminPath(parsed.pathname)) return url;
  parsed.search = '';
  return absolute ? parsed.href : `${parsed.pathname}${parsed.hash}`;
}
