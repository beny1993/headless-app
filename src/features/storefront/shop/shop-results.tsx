'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutGrid, List } from 'lucide-react';
import {
  SHOP_SORT_OPTIONS,
  buildShopHref,
  updateShopQuery,
  type ShopQuery,
  type ShopSort,
} from './shop-query';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

type ViewMode = 'grid' | 'list';

/**
 * The results toolbar and the container the product cards land in.
 *
 * One client component for both because they share exactly one piece of state:
 * the grid/list view. That view is the only thing on this page that is *not* in
 * the URL — it is a display preference rather than a filter, so putting it
 * there would make two links for one set of results (story: client-side view
 * state only).
 *
 * The cards themselves stay server components, passed in as `children`. Nothing
 * about a product crosses to the browser to satisfy a layout toggle: the
 * container publishes `data-view` and the card's own classes react to it.
 *
 * Sort, unlike the view, is a URL parameter — it changes which products are on
 * the page, so it has to survive a shared link.
 */
export function ShopResults({
  query,
  total,
  count,
  children,
}: {
  query: ShopQuery;
  /** Matches across the whole filtered result, not just this page. */
  total: number;
  /** How many cards are actually below; zero means the empty state is. */
  count: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const sortId = useId();
  const [view, setView] = useState<ViewMode>('grid');
  const [pending, startTransition] = useTransition();

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex gap-2"
          role="group"
          aria-label="نحوه نمایش محصولات"
        >
          <ViewButton
            mode="grid"
            current={view}
            onSelect={setView}
            label="نمایش شبکه‌ای"
          >
            <LayoutGrid size={14} aria-hidden="true" />
          </ViewButton>
          <ViewButton
            mode="list"
            current={view}
            onSelect={setView}
            label="نمایش فهرستی"
          >
            <List size={14} aria-hidden="true" />
          </ViewButton>
        </div>

        <div className="flex items-center gap-3">
          <span
            className="text-muted-foreground nums text-sm"
            aria-live="polite"
          >
            {formatNumber(total)} محصول
          </span>
          <label htmlFor={sortId} className="sr-only">
            ترتیب نمایش
          </label>
          <select
            id={sortId}
            value={query.sort}
            onChange={(event) =>
              startTransition(() =>
                router.push(
                  buildShopHref(
                    updateShopQuery(query, {
                      sort: event.target.value as ShopSort,
                    }),
                  ),
                ),
              )
            }
            // Native `<select>`: correct on mobile, nothing gained from a portal.
            className="border-border bg-background focus-visible:border-accent-strong rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors"
            aria-busy={pending}
            data-umami-event="shop-sort-change"
          >
            {SHOP_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        // The layout switch, in one attribute. `group/results` is named so it
        // cannot collide with the unnamed `group` a ProductCard uses for its
        // own hover.
        data-view={view}
        className={cn(
          'group/results min-w-0 flex-1',
          count > 0 &&
            (view === 'grid'
              ? 'grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3'
              : 'flex flex-col gap-4'),
        )}
      >
        {children}
      </div>
    </>
  );
}

function ViewButton({
  mode,
  current,
  onSelect,
  label,
  children,
}: {
  mode: ViewMode;
  current: ViewMode;
  onSelect: (mode: ViewMode) => void;
  label: string;
  children: React.ReactNode;
}) {
  const active = current === mode;

  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'rounded-xl px-4 py-2.5 text-sm font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'border-border hover:bg-secondary border',
      )}
      data-umami-event={`shop-view-${mode}`}
    >
      {children}
    </button>
  );
}
