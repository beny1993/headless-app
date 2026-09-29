// The admin dashboard's aggregates, assembled from real orders. One DAO
// (OrderDao), but the Jalali-month bucketing is display logic that does not
// belong in a DAO, so the wiring lives here in src/logic/.
//
// Revenue definition (see OrderDao.revenueSummary): an order counts iff its
// status is a booked one {paid, processing, shipped, delivered} AND it has a
// settled payment. So a COD order still pending at processing/shipped is not
// revenue (its cash arrives at delivery), and a paid order later cancelled is
// not revenue (it is being refunded). Money is summed as integer Toman.
//
// Months are bucketed by *Jalali* month via Intl (format.ts), never by Gregorian
// month — a Gregorian bucket straddles two Jalali months and would mislabel the
// chart. No date dependency.
//
// «مشتریان جدید این ماه» is UserDao's customers-only count from 00:00 Tehran on
// this Jalali month's 1st, the same call the admin users page makes.
import { OrderDao } from '@/db/dao/OrderDao';
import { UserDao } from '@/db/dao/UserDao';
import {
  formatJalaliMonth,
  jalaliMonthStart,
  jalaliYearMonth,
} from '@/lib/format';
import { ORDER_STATUSES } from '@/lib/orders/order-status';

/** One month's bar on the dashboard charts. `key` is `year*12 + (month-1)`. */
type MonthlyPoint = {
  key: number;
  label: string;
  revenue: number;
  orders: number;
};

/** The dashboard's top-line stat tiles. All integer Toman / counts. */
export type DashboardStats = {
  totalRevenue: number;
  paidOrderCount: number;
  averageOrderValue: number;
  awaitingProcessing: number;
  /** Customers (not admins) who joined in the current Jalali month. */
  newCustomersThisMonth: number;
};

type DashboardReport = {
  months: MonthlyPoint[];
  stats: DashboardStats;
};

const MONTHS_BACK = 6;

// A window comfortably wider than six Jalali months (each ≤ 31 days) so the DB
// read never misses an order the bucketing would place, and never scans the
// whole table. Rows past the six buckets are dropped in JS.
const WINDOW_DAYS = MONTHS_BACK * 31 + 2;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A monotonic Jalali month ordinal for a date: `year*12 + (month-1)`. */
const monthIndex = (date: Date): number => {
  const { year, month } = jalaliYearMonth(date);
  return year * 12 + (month - 1);
};

/**
 * The last `n` Jalali months up to `now`, oldest first, each `{ key, label }`.
 * Walks back a day at a time from `now` so each label is produced by `Intl` from
 * a real instant inside that month — no reverse Jalali→Gregorian arithmetic.
 */
export function lastJalaliMonths(
  now: Date,
  n = MONTHS_BACK,
): { key: number; label: string }[] {
  const out: { key: number; label: string }[] = [];
  const cursor = new Date(now.getTime());
  let need = monthIndex(now);
  for (let i = 0; i < n; i++) {
    while (monthIndex(cursor) > need) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    out.push({ key: need, label: formatJalaliMonth(cursor) });
    need -= 1;
  }
  return out.reverse();
}

/**
 * Fold revenue rows into the last `n` Jalali-month buckets (oldest first). Pure:
 * empty input yields `n` zeroed buckets with their labels, and any row outside
 * the window is ignored. Sums stay integer because the inputs are integer Toman.
 */
export function bucketRevenueByJalaliMonth(
  rows: { createdAt: Date; total: number }[],
  now: Date,
  n = MONTHS_BACK,
): MonthlyPoint[] {
  const months = lastJalaliMonths(now, n);
  const byKey = new Map<number, MonthlyPoint>(
    months.map((m) => [m.key, { ...m, revenue: 0, orders: 0 }]),
  );
  for (const row of rows) {
    const bucket = byKey.get(monthIndex(row.createdAt));
    if (!bucket) continue;
    bucket.revenue += row.total;
    bucket.orders += 1;
  }
  return months.map((m) => byKey.get(m.key)!);
}

/**
 * The whole dashboard read: the six-month revenue/order-count series, the
 * all-time top-line stats and this month's new customers. `now` is injectable
 * so the bucketing is testable.
 */
export async function buildDashboardReport(
  now: Date = new Date(),
): Promise<DashboardReport> {
  const cutoff = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const [rows, summary, awaitingProcessing, newCustomersThisMonth] =
    await Promise.all([
      OrderDao.revenueOrdersSince(cutoff),
      OrderDao.revenueSummary(),
      OrderDao.countByStatus(ORDER_STATUSES.PAID),
      UserDao.countCustomers(jalaliMonthStart(now)),
    ]);

  const averageOrderValue =
    summary.orderCount > 0
      ? Math.round(summary.revenue / summary.orderCount)
      : 0;

  return {
    months: bucketRevenueByJalaliMonth(rows, now),
    stats: {
      totalRevenue: summary.revenue,
      paidOrderCount: summary.orderCount,
      averageOrderValue,
      awaitingProcessing,
      newCustomersThisMonth,
    },
  };
}
