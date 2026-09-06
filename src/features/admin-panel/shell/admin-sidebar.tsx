'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  Home,
  LogOut,
  Menu,
  Package,
  Settings,
  ShoppingCart,
  X,
} from 'lucide-react';
import { PATHS, PROTECTED_PATHS } from '@/lib/constant/paths';
import { cn } from '@/lib/utils';

// The admin panel's sidebar, ported from the Figma admin shell
// (`design/src/app/App.tsx` → AdminPage). Every admin page renders inside this
// frame via the (protected) layout.
//
// Two independent axes, so mobile never inherits the desktop width:
//   · Desktop (`lg`+): an in-flow rail, collapsible w-56 ↔ w-16 (`open`).
//   · Below `lg`: an off-canvas drawer (`mobileOpen`), `fixed` so it consumes
//     ZERO content width when closed — opened by the header hamburger, dismissed
//     by the backdrop or the drawer's close button, and auto-closed on navigation.
//     Defaults closed, so the first paint is hydration-safe (no `window` read).
//
// One entry per admin page that exists (dashboard, orders, products, shipping).
// `NAV_ITEMS` is data-driven, so a future admin page adds its entry here.
type NavItem = {
  href: string;
  label: string;
  icon: typeof Home;
  /** Active when the path is exactly `href` (`exact`) or starts with it. */
  match: 'exact' | 'prefix';
};

const NAV_ITEMS: NavItem[] = [
  { href: PROTECTED_PATHS.INDEX, label: 'داشبورد', icon: Home, match: 'exact' },
  {
    href: PROTECTED_PATHS.ORDERS,
    label: 'سفارش‌ها',
    icon: ShoppingCart,
    match: 'prefix',
  },
  {
    href: PROTECTED_PATHS.PRODUCTS,
    label: 'محصولات',
    icon: Package,
    match: 'prefix',
  },
  {
    href: PROTECTED_PATHS.SHIPPING,
    label: 'نرخ ارسال',
    icon: Settings,
    match: 'prefix',
  },
];

const isActive = (pathname: string, item: NavItem): boolean =>
  item.match === 'exact'
    ? pathname === item.href
    : pathname.startsWith(item.href);

export function AdminSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(true); // desktop collapse
  const [mobileOpen, setMobileOpen] = useState(false); // mobile drawer

  // Labels are shown unless the desktop rail is collapsed. The mobile drawer is
  // full width, so on it `open` stays at its default `true` and labels show.
  const showLabels = open;

  return (
    <>
      {/* Mobile-only opener — sits in the header's start gutter (the layout pads
          the header `ps-16` below `lg` to leave room). Hidden once the desktop
          rail takes over at `lg`. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="باز کردن منوی مدیریت"
        aria-expanded={mobileOpen}
        data-umami-event="admin-panel-mobile-menu-open"
        className="bg-ink fixed start-4 top-3.5 z-30 flex h-9 w-9 items-center justify-center rounded-lg text-white lg:hidden"
      >
        <Menu size={16} aria-hidden="true" />
      </button>

      {/* Backdrop — only while the drawer is open, below `lg`. */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="بستن منو"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        />
      )}

      <aside
        className={cn(
          'bg-ink z-50 shrink-0 flex-col lg:transition-[width] lg:duration-300',
          // Below lg: a `fixed` off-canvas drawer that consumes no content width;
          // at lg+ an in-flow rail. Visibility is a DISPLAY toggle, not a
          // transform: `hidden` when the mobile drawer is closed, `flex` when
          // open, `lg:flex` always at desktop — the same reliable hidden/lg:flex
          // override the shell's own buttons use.
          'fixed inset-y-0 start-0 lg:static lg:z-auto',
          mobileOpen ? 'flex' : 'hidden',
          'lg:flex',
          // ONE width scheme for both contexts (mobile drawer stays w-56 — its
          // collapse toggle is desktop-only and `open` defaults true).
          open ? 'w-56' : 'w-16',
        )}
      >
        <div className="flex items-center gap-3 border-b border-white/10 p-4">
          {/* Desktop collapse toggle. */}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? 'جمع کردن منوی کناری' : 'باز کردن منوی کناری'}
            aria-expanded={open}
            data-umami-event="admin-panel-sidebar-toggle"
            className="hidden h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20 lg:flex"
          >
            <Menu size={14} aria-hidden="true" />
          </button>
          {/* Mobile close. */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="بستن منو"
            data-umami-event="admin-panel-mobile-menu-close"
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20 lg:hidden"
          >
            <X size={14} aria-hidden="true" />
          </button>
          {showLabels && <span className="font-black text-white">Smokey</span>}
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                aria-current={active ? 'page' : undefined}
                data-umami-event={`admin-panel-nav-${item.label}`}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-accent-strong text-white'
                    : 'text-white/70 hover:bg-white/10 hover:text-white',
                )}
              >
                <Icon size={16} aria-hidden="true" />
                {showLabels && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-3">
          <Link
            href={PATHS.HOME}
            onClick={() => setMobileOpen(false)}
            data-umami-event="admin-panel-sidebar-storefront"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut size={16} aria-hidden="true" />
            {showLabels && <span>بازگشت به فروشگاه</span>}
          </Link>
        </div>
      </aside>
    </>
  );
}
