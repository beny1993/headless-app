import Image from 'next/image';
import Link from 'next/link';
import { Search, User } from 'lucide-react';
import { MobileMenu } from './mobile-menu';
import { NAV_TARGETS } from './nav-links';
import { CartDrawer } from '@/features/storefront/cart/cart-drawer';
import { PATHS } from '@/lib/constant/paths';
import type { ContentValue } from '@/lib/content/site-content';
import { ContentLink } from '@/features/storefront/content-link';
import { resolveLink, type LinkTargets } from '@/lib/content/link';

const iconButton =
  'flex size-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary';

/**
 * Storefront navigation bar, ported from the prototype's `Navbar`.
 *
 * Two deliberate omissions from the design: the wishlist heart (wishlist is
 * backlog) and the «مجله» link (no magazine exists). The prototype's
 * transparent-over-dark-hero treatment is also left out for good: it only
 * reads on the home hero, and a bar that turns white-on-cream on every other
 * page — or on the way back up a scrolled home page — is worth more than the
 * one screen it flatters. The home hero sits below the bar instead.
 *
 * A server component: only the mobile menu and the cart drawer — which owns
 * the cart button and its badge — need client state.
 *
 * The wordmark, subtitle, nav labels and their destinations are admin content
 * (`header`); the icons, their hrefs and aria-labels stay in code. Label i goes to
 * its saved `navLinks[i]`, else to `NAV_TARGETS[i]`, and the same resolved list is
 * handed to the mobile menu so the two can never drift. The wordmark is a display string
 * independent of `DEFAULT_SITE_NAME`, so editing it never touches a page <title>.
 */
export function Navbar({
  content,
  targets,
}: {
  content: ContentValue<'header'>;
  targets: LinkTargets;
}) {
  const links = NAV_TARGETS.map((fallback, i) => ({
    label: content.nav[i],
    ...resolveLink(content.navLinks?.[i], fallback, targets),
  }));

  return (
    <nav className="bg-background/95 fixed inset-x-0 top-0 z-50 shadow-sm backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Icons — the start side in RTL */}
          <div className="flex items-center gap-1">
            <Link
              href={PATHS.SHOP}
              className={iconButton}
              aria-label="جستجو در محصولات"
              data-umami-event="nav-search-open"
            >
              <Search size={18} aria-hidden="true" />
            </Link>
            <Link
              href={PATHS.ACCOUNT}
              className={iconButton}
              aria-label="حساب کاربری"
              data-umami-event="nav-account-open"
            >
              <User size={18} aria-hidden="true" />
            </Link>
            <CartDrawer className={iconButton} />
            <MobileMenu links={links} />
          </div>

          {/* Links — desktop only; the mobile menu carries them below md.
              Index key, not the href: the hrefs repeat in the footer and a label
              is content, so the stable identity is the position. */}
          <div className="hidden items-center gap-6 md:flex">
            {links.map((link, index) => (
              <ContentLink
                key={index}
                href={link.href}
                external={link.external}
                className="text-foreground hover:text-accent-strong text-sm font-medium transition-colors"
                data-umami-event="nav-link-click"
              >
                {link.label}
              </ContentLink>
            ))}
          </div>

          {/* Wordmark — the end side in RTL */}
          <Link
            href={PATHS.HOME}
            className="flex items-center gap-2"
            data-umami-event="nav-logo-home"
          >
            <Image
              src="/brand/mark.png"
              width={44}
              height={44}
              alt={`لوگوی ${content.brand}`}
              priority
              className="size-11 shrink-0"
            />
            <span
              aria-hidden="true"
              className="text-foreground text-2xl font-black tracking-tight"
            >
              {content.brand}
            </span>
            <span className="text-muted-foreground border-border ms-1 hidden border-s ps-2 text-xs sm:inline">
              {content.tagline}
            </span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
