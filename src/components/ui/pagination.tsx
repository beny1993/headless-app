import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatNumber } from '@/lib/format';
import { pageWindow } from '@/lib/pagination';
import { cn } from '@/lib/utils';

/**
 * Page links for a paged list: the shop, and the admin products and orders
 * tables. The caller builds each page's URL (`hrefFor`), so the list's own
 * filters ride along on every link.
 *
 * Real `<Link>`s, not buttons that push: a page is a URL, so it must be
 * shareable, middle-clickable and correct under the back button without any of
 * this file running in the browser. There is no `'use client'` here: the pages
 * that render it are server components, and `hrefFor` is a function, which
 * cannot cross into a client component.
 *
 * In RTL the chevrons point the other way round from a Latin layout: the
 * *previous* page sits to the right, so it takes `ChevronRight`.
 */
export function Pagination({
  page,
  totalPages,
  hrefFor,
  label,
  event,
  className,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
  /** The nav landmark's accessible name. */
  label: string;
  /** Umami event prefix: the links report `-prev`, `-page` and `-next`. */
  event: string;
  className?: string;
}) {
  // One page is not a pagination, and zero pages means the empty state is
  // already saying everything there is to say.
  if (totalPages < 2) return null;

  return (
    <nav
      aria-label={label}
      className={cn('flex items-center justify-center gap-2', className)}
    >
      <PageStep
        href={hrefFor(page - 1)}
        label="صفحه قبل"
        disabled={page <= 1}
        event={`${event}-prev`}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </PageStep>

      {pageWindow(page, totalPages).map((number) => {
        const current = number === page;

        return (
          <Link
            key={number}
            href={hrefFor(number)}
            aria-current={current ? 'page' : undefined}
            aria-label={`صفحه ${formatNumber(number)}`}
            className={cn(
              'nums flex size-10 items-center justify-center rounded-xl text-sm font-semibold transition-colors',
              current
                ? 'bg-accent-strong text-white'
                : 'border-border hover:bg-secondary border',
            )}
            data-umami-event={`${event}-page`}
          >
            {formatNumber(number)}
          </Link>
        );
      })}

      <PageStep
        href={hrefFor(page + 1)}
        label="صفحه بعد"
        disabled={page >= totalPages}
        event={`${event}-next`}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </PageStep>
    </nav>
  );
}

/**
 * Previous/next. At either end the control becomes plain text rather than a
 * link: there is nowhere to go, and a disabled-looking link that still
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
