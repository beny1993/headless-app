import Link from 'next/link';
import { Search, User } from 'lucide-react';
import { MobileMenu } from './mobile-menu';
import { NAV_LINKS } from './nav-links';
import { CartDrawer } from '@/features/storefront/cart/cart-drawer';
import { PATHS } from '@/lib/constant/paths';

const iconButton =
  'flex size-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary';

/**
 * Storefront navigation bar, ported from the prototype's `Navbar`.
 *
 * Two deliberate omissions from the design: the wishlist heart (wishlist is
 * backlog) and the «مجله» link (no magazine exists). The prototype's
 * transparent-over-dark-hero treatment is also left out — it only reads
 * correctly against the home hero, which story 6 ports; until then white nav
 * text on a cream page would be invisible. Ships solid.
 *
 * A server component: only the mobile menu and the cart drawer — which owns
 * the cart button and its badge — need client state.
 */
export function Navbar() {
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
            <MobileMenu />
          </div>

          {/* Links — desktop only; the mobile menu carries them below md */}
          <div className="hidden items-center gap-6 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-foreground hover:text-accent-strong text-sm font-medium transition-colors"
                data-umami-event="nav-link-click"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Wordmark — the end side in RTL */}
          <Link
            href={PATHS.HOME}
            className="flex items-center gap-2"
            data-umami-event="nav-logo-home"
          >
            <span className="text-foreground text-2xl font-black tracking-tight">
              Smokey
            </span>
            <span className="text-muted-foreground border-border ms-1 hidden border-s ps-2 text-xs sm:inline">
              فروشگاه حیوانات
            </span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
