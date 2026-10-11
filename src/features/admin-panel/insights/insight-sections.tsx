import Link from 'next/link';
import type { ReactNode } from 'react';
import { adminEditProductPath, PROTECTED_PATHS } from '@/lib/constant/paths';
import { formatNumber, formatPercent, formatToman } from '@/lib/format';
import {
  INSIGHT_WINDOW_DAYS,
  type InsightWindowDays,
} from '@/lib/insights/window';
import { cn } from '@/lib/utils';
import type {
  GroupInsight,
  InsightNumbers,
  ProductInsight,
  TrafficSource,
  ViewsStatus,
} from '@/logic/admin/product-insights';
import { AdminTable } from '@/features/admin-panel/shared/admin-table';
import { Pill } from '@/features/admin-panel/shared/pill';
import { StockBadge } from '@/features/admin-panel/products/stock-badge';

const CELL = 'px-4 py-3.5';
const NUM_CELL = `${CELL} nums whitespace-nowrap`;
const ROW = 'border-border hover:bg-secondary/20 border-t transition-colors';

/** The insights page for one window. */
export const insightsHref = (days: InsightWindowDays) =>
  `${PROTECTED_PATHS.INSIGHTS}?days=${days}`;

/** «—» where Umami gave no number, so a missing view never reads as zero. */
const viewCount = (value: number | null) =>
  value === null ? '—' : formatNumber(value);

/**
 * Orders over views: of the people who opened it, how many bought. `—` with no
 * views to divide by. Orders, not units, so one shopper buying five is one.
 */
const conversion = ({ orders, views }: InsightNumbers) =>
  views ? formatPercent(orders / views) : '—';

/** The 7 / 30 / 90 day switch: plain links, the current one marked. */
export function WindowSwitch({ current }: { current: InsightWindowDays }) {
  return (
    <nav aria-label="بازه زمانی" className="flex flex-wrap gap-2">
      {INSIGHT_WINDOW_DAYS.map((days) => (
        <Link
          key={days}
          href={insightsHref(days)}
          aria-current={days === current ? 'page' : undefined}
          data-umami-event={`admin-panel-insights-window-${days}`}
          className={cn(
            'border-border flex h-10 items-center rounded-xl border px-4 text-sm font-medium transition-colors',
            days === current
              ? 'bg-ink border-ink text-white'
              : 'hover:bg-secondary bg-white',
          )}
        >
          {formatNumber(days)} روز اخیر
        </Link>
      ))}
    </nav>
  );
}

const VIEWS_NOTICE: Record<Exclude<ViewsStatus, 'ok'>, string> = {
  off: 'آمار بازدید از Umami برای این سایت تنظیم نشده، پس این صفحه فقط فروش را نشان می‌دهد.',
  unavailable:
    'آمار بازدید الان از Umami نرسید. فروش‌ها کامل است؛ کمی بعد صفحه را دوباره باز کنید.',
};

/** Why the view columns are empty, when they are. */
export function ViewsNotice({ status }: { status: ViewsStatus }) {
  if (status === 'ok') return null;
  return (
    <p
      role="status"
      className="bg-warning-soft text-warning rounded-2xl px-4 py-3 text-sm"
    >
      {VIEWS_NOTICE[status]}
    </p>
  );
}

/** Three tiles: units, revenue, product pageviews. */
export function InsightTiles({ totals }: { totals: InsightNumbers }) {
  const tiles = [
    ['تعداد فروخته‌شده', formatNumber(totals.units)],
    ['درآمد محصولات', formatToman(totals.revenue)],
    ['بازدید صفحه محصولات', viewCount(totals.views)],
  ] as const;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {tiles.map(([label, value]) => (
        <div
          key={label}
          className="border-border rounded-2xl border bg-white p-5"
        >
          <p className="nums text-2xl font-black">{value}</p>
          <p className="text-muted-foreground text-sm">{label}</p>
        </div>
      ))}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="border-border text-muted-foreground rounded-2xl border bg-white px-4 py-8 text-center text-sm">
      {children}
    </p>
  );
}

function ProductLink({
  product,
  event,
}: {
  product: ProductInsight;
  event: string;
}) {
  return (
    <Link
      href={adminEditProductPath(product.id)}
      data-umami-event={event}
      className="hover:text-accent-strong line-clamp-2 font-medium underline-offset-4 hover:underline"
    >
      {product.title}
    </Link>
  );
}

/** The product table, most sold first. */
export function ProductTable({ products }: { products: ProductInsight[] }) {
  return (
    <Section
      title="محصولات"
      hint="بیشترین فروش اول، بعد بیشترین بازدید. نرخ تبدیل یعنی از هر صد بازدید، چند سفارش."
    >
      {products.length === 0 ? (
        <Empty>در این بازه نه فروشی ثبت شده و نه بازدیدی.</Empty>
      ) : (
        <AdminTable
          headings={[
            'محصول',
            'دسته',
            'بازدید',
            'فروش',
            'درآمد',
            'نرخ تبدیل',
            'موجودی',
          ]}
        >
          {products.map((product) => (
            <tr key={product.id} className={ROW}>
              <td className={cn(CELL, 'max-w-xs')}>
                <ProductLink
                  product={product}
                  event="admin-panel-insights-product-open"
                />
                {!product.isActive && (
                  <span className="mt-1 block">
                    <Pill tone="muted">غیرفعال</Pill>
                  </span>
                )}
              </td>
              <td className={cn(CELL, 'text-muted-foreground text-xs')}>
                {product.category}
              </td>
              <td className={NUM_CELL}>{viewCount(product.views)}</td>
              <td className={NUM_CELL}>{formatNumber(product.units)}</td>
              <td className={cn(NUM_CELL, 'font-semibold')}>
                {formatToman(product.revenue)}
              </td>
              <td className={NUM_CELL}>{conversion(product)}</td>
              <td className={cn(CELL, 'whitespace-nowrap')}>
                <StockBadge stock={product.stock} />
              </td>
            </tr>
          ))}
        </AdminTable>
      )}
    </Section>
  );
}

/** A roll-up (by category, by pet) with the same numbers as the products. */
export function GroupTable({
  title,
  heading,
  hint,
  groups,
}: {
  title: string;
  heading: string;
  hint?: string;
  groups: GroupInsight[];
}) {
  return (
    <Section title={title} hint={hint}>
      {groups.length === 0 ? (
        <Empty>چیزی برای نمایش نیست.</Empty>
      ) : (
        <AdminTable
          headings={[heading, 'بازدید', 'فروش', 'درآمد', 'نرخ تبدیل']}
        >
          {groups.map((group) => (
            <tr key={group.key} className={ROW}>
              <td className={cn(CELL, 'font-medium')}>{group.label}</td>
              <td className={NUM_CELL}>{viewCount(group.views)}</td>
              <td className={NUM_CELL}>{formatNumber(group.units)}</td>
              <td className={cn(NUM_CELL, 'font-semibold')}>
                {formatToman(group.revenue)}
              </td>
              <td className={NUM_CELL}>{conversion(group)}</td>
            </tr>
          ))}
        </AdminTable>
      )}
    </Section>
  );
}

/** A short list of products worth a look, each with its view count. */
export function ActionList({
  title,
  hint,
  empty,
  products,
  event,
}: {
  title: string;
  hint: string;
  empty: string;
  products: ProductInsight[];
  event: string;
}) {
  return (
    <Section title={title} hint={hint}>
      {products.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ol className="border-border divide-border divide-y rounded-2xl border bg-white">
          {products.map((product) => (
            <li
              key={product.id}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <ProductLink product={product} event={event} />
              <span className="text-muted-foreground nums shrink-0 text-xs">
                {viewCount(product.views)} بازدید
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

/** Where the site's visitors came from, by referring site. */
export function SourceList({ sources }: { sources: TrafficSource[] }) {
  return (
    <Section
      title="ورودی از کجا"
      hint="بازدیدهای کل سایت به تفکیک سایتی که از آن آمده‌اند؛ ورود مستقیم شمرده نمی‌شود."
    >
      {sources.length === 0 ? (
        <Empty>در این بازه ورودی از سایت دیگری ثبت نشده.</Empty>
      ) : (
        <ol className="border-border divide-border divide-y rounded-2xl border bg-white">
          {sources.map((source) => (
            <li
              key={source.label}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <bdi className="font-medium">{source.label}</bdi>
              <span className="text-muted-foreground nums shrink-0 text-xs">
                {formatNumber(source.visits)} بازدید
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
