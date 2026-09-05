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
} from 'lucide-react';
import { PATHS, PROTECTED_PATHS } from '@/lib/constant/paths';
import { cn } from '@/lib/utils';

// The admin panel's sidebar, ported from the Figma admin shell
// (`design/src/app/App.tsx` → AdminPage). Collapsible (client state) with the
// active item derived from the current path — every admin page renders inside
// this frame via the (protected) layout.
//
// Only the pages this story delivers are linked. Later admin stories
// (`Story - Admin Orders and Dashboard`, shipping rates) add their entry to
// `NAV_ITEMS` when they add the page behind it — a data-driven list, so that is
// a one-line change, not a rewrite of the shell.
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
  const [open, setOpen] = useState(true);

  return (
    <aside
      className={cn(
        'bg-ink flex shrink-0 flex-col transition-[width] duration-300',
        open ? 'w-56' : 'w-16',
      )}
    >
      <div className="flex items-center gap-3 border-b border-white/10 p-4">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? 'جمع کردن منوی کناری' : 'باز کردن منوی کناری'}
          aria-expanded={open}
          data-umami-event="admin-panel-sidebar-toggle"
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <Menu size={14} aria-hidden="true" />
        </button>
        {open && <span className="font-black text-white">Smokey</span>}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
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
              {open && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-3">
        <Link
          href={PATHS.HOME}
          data-umami-event="admin-panel-sidebar-storefront"
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <LogOut size={16} aria-hidden="true" />
          {open && <span>بازگشت به فروشگاه</span>}
        </Link>
      </div>
    </aside>
  );
}
