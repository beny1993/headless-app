import Link from 'next/link';
import type { AnchorHTMLAttributes } from 'react';

/**
 * A content link, rendered as its resolved destination (`resolveLink`) says:
 * in-app navigation for the site's own pages, and for an external URL a plain
 * anchor that opens in a new tab without handing that page `window.opener` or a
 * referrer. `target` and `rel` are set after the caller's props, so no call site
 * can drop them.
 */
export function ContentLink({
  href,
  external = false,
  ...props
}: { href: string; external?: boolean } & Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
>) {
  if (!external) return <Link href={href} {...props} />;
  return <a {...props} href={href} target="_blank" rel="noopener noreferrer" />;
}
