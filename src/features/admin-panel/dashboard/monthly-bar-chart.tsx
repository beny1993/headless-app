import { toPersianDigits } from '@/lib/format';

/** One month's bar. `value` is already the aggregate (Toman or a count). */
export type ChartPoint = { label: string; value: number };

/**
 * A dependency-free monthly bar chart — six labelled bars scaled to the series
 * max. Deliberately not a charting library: the design used Recharts, but six
 * bars are a flexbox and a height percentage, and a chart lib is a large client
 * dependency this does not need. Pure/presentational, so it stays a server
 * component. `formatValue` renders the Persian tooltip (Toman or a plain count).
 *
 * Bars are DOM-ordered oldest→newest; inside the RTL shell that puts the oldest
 * month on the right, which is the Persian reading order for a timeline.
 */
export function MonthlyBarChart({
  title,
  points,
  formatValue,
}: {
  title: string;
  points: ChartPoint[];
  formatValue: (value: number) => string;
}) {
  const max = Math.max(...points.map((point) => point.value), 1);
  const empty = points.every((point) => point.value === 0);

  return (
    <div className="border-border rounded-2xl border bg-white p-5">
      <p className="mb-4 font-bold">{title}</p>
      {empty ? (
        <div className="text-muted-foreground flex h-48 items-center justify-center text-sm">
          هنوز داده‌ای برای نمایش نیست.
        </div>
      ) : (
        <div className="flex h-48 items-end gap-2">
          {points.map((point) => (
            <div
              key={point.label}
              className="flex h-full min-w-0 flex-1 flex-col items-center gap-1.5"
            >
              <div className="flex w-full flex-1 items-end">
                <div
                  className="bg-accent-strong w-full rounded-t-md transition-[height]"
                  style={{
                    height: `${point.value === 0 ? 0 : Math.max((point.value / max) * 100, 3)}%`,
                  }}
                  title={formatValue(point.value)}
                  aria-hidden="true"
                />
              </div>
              <span className="text-muted-foreground w-full truncate text-center text-[11px]">
                {point.label}
              </span>
              <span className="sr-only">
                {point.label}: {formatValue(point.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A compact count label in Persian digits — the order-count chart's tooltip. */
export const countLabel = (value: number) => toPersianDigits(value);
