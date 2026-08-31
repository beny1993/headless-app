import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  buildShopHref,
  shopPageWindow,
  updateShopQuery,
  type ShopQuery,
} from './shop-query';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Page links for the current filter set.
 *
 * Real `<Link>`s, not buttons that push: a page is a URL, so it must be
 * shareable, middle-clickable and correct under the back button without any
 * of this file running in the browser. There is no `'use client'` here.
 *
 * In RTL the chevrons point the other way round from a Latin layout — the
 * *previous* page sits to the right, so it takes `ChevronRight`.
 */
export function ShopPagination({
  query,
  totalPages,
}: {
  query: ShopQuery;
  totalPages: number;
}) {
  // One page is not a pagination, and zero pages means the empty state is
  // already saying everything there is to say.
  if (totalPages < 2) return null;

  const pages = shopPageWindow(query.page, totalPages);
  const href = (page: number) =>
    buildShopHref(updateShopQuery(query, { page }));

  return (
    <nav
      aria-label="صفحه‌بندی محصولات"
      className="mt-10 flex items-center justify-center gap-2"
    >
      <PageStep
        href={href(query.page - 1)}
        label="صفحه قبل"
        disabled={query.page <= 1}
        event="shop-pagination-prev"
      >
        <ChevronRight size={16} aria-hidden="true" />
      </PageStep>

      {pages.map((page) => {
        const current = page === query.page;

        return (
          <Link
            key={page}
            href={href(page)}
            aria-current={current ? 'page' : undefined}
            aria-label={`صفحه ${formatNumber(page)}`}
            className={cn(
              'nums flex size-10 items-center justify-center rounded-xl text-sm font-semibold transition-colors',
              current
                ? 'bg-accent-strong text-white'
                : 'border-border hover:bg-secondary border',
            )}
            data-umami-event="shop-pagination-page"
          >
            {formatNumber(page)}
          </Link>
        );
      })}

      <PageStep
        href={href(query.page + 1)}
        label="صفحه بعد"
        disabled={query.page >= totalPages}
        event="shop-pagination-next"
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </PageStep>
    </nav>
  );
}

/**
 * Previous/next. At either end the control becomes plain text rather than a
 * link — there is nowhere to go, and a disabled-looking link that still
 * navigates is worse than no link at all.
 */
function PageStep({
  href,
  label,
  disabled,
  event,
  children,
}: {
  href: string;
  label: string;
  disabled: boolean;
  event: string;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span
        className="text-muted-foreground/40 flex size-10 items-center justify-center"
        aria-hidden="true"
      >
        {children}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      className="border-border hover:bg-secondary flex size-10 items-center justify-center rounded-xl border transition-colors"
      data-umami-event={event}
    >
      {children}
    </Link>
  );
}
