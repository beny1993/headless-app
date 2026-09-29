// Pure dashboard bucketing — no database. The revenue-set membership and the
// summed totals are proven against Postgres in
// src/db/dao/OrderDao.admin.integration.test.ts; this pins the Jalali-month
// windowing and the empty state, which are pure functions of (rows, now), and,
// with the DAOs mocked, the window «مشتریان جدید این ماه» is counted over.
import { describe, expect, it, vi } from 'vitest';
import {
  bucketRevenueByJalaliMonth,
  buildDashboardReport,
  lastJalaliMonths,
} from '@/logic/orders/dashboard-report';

// Only `buildDashboardReport` reaches these; the bucketing below is pure.
const dao = vi.hoisted(() => ({
  countCustomers: vi.fn(async () => 7),
}));
vi.mock('@/db/dao/OrderDao', () => ({
  OrderDao: {
    revenueOrdersSince: async () => [],
    revenueSummary: async () => ({ revenue: 0, orderCount: 0 }),
    countByStatus: async () => 0,
  },
}));
vi.mock('@/db/dao/UserDao', () => ({
  UserDao: { countCustomers: dao.countCustomers },
}));

// 5 Shahrivar 1405 (month 6). The six months ending here, oldest first.
const NOW = new Date(Date.UTC(2026, 8, 5, 12, 0, 0));
const EXPECTED_LABELS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
];

describe('lastJalaliMonths', () => {
  it('returns the last six Jalali months, oldest first, with Persian labels', () => {
    expect(lastJalaliMonths(NOW).map((m) => m.label)).toEqual(EXPECTED_LABELS);
  });

  it('gives strictly increasing, consecutive month keys', () => {
    const keys = lastJalaliMonths(NOW).map((m) => m.key);
    expect(keys).toHaveLength(6);
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i] - keys[i - 1]).toBe(1);
    }
  });
});

describe('bucketRevenueByJalaliMonth', () => {
  it('handles the empty state — six zeroed buckets, labels intact', () => {
    const months = bucketRevenueByJalaliMonth([], NOW);
    expect(months.map((m) => m.label)).toEqual(EXPECTED_LABELS);
    expect(months.every((m) => m.revenue === 0 && m.orders === 0)).toBe(true);
  });

  it('sums revenue and counts orders into the right month, as integers', () => {
    const rows = [
      // Two in Shahrivar (month 6) — the last bucket.
      { createdAt: new Date(Date.UTC(2026, 8, 5)), total: 1_000_000 },
      { createdAt: new Date(Date.UTC(2026, 8, 20)), total: 2_500_000 },
      // One in Mordad (month 5) — the fifth bucket.
      { createdAt: new Date(Date.UTC(2026, 7, 10)), total: 700_000 },
    ];
    const months = bucketRevenueByJalaliMonth(rows, NOW);

    const shahrivar = months[5];
    const mordad = months[4];
    expect(shahrivar.label).toBe('شهریور');
    expect(shahrivar.revenue).toBe(3_500_000);
    expect(shahrivar.orders).toBe(2);
    expect(mordad.label).toBe('مرداد');
    expect(mordad.revenue).toBe(700_000);
    expect(mordad.orders).toBe(1);
    // Nothing leaked into the other four months.
    expect(months.slice(0, 4).every((m) => m.revenue === 0)).toBe(true);
  });

  it('drops rows outside the six-month window', () => {
    const rows = [
      { createdAt: new Date(Date.UTC(2025, 0, 1)), total: 9_000_000 }, // long before
      { createdAt: new Date(Date.UTC(2026, 8, 5)), total: 1_000_000 }, // in window
    ];
    const months = bucketRevenueByJalaliMonth(rows, NOW);
    const total = months.reduce((sum, m) => sum + m.revenue, 0);
    expect(total).toBe(1_000_000);
  });
});

describe('buildDashboardReport', () => {
  it("counts new customers from 00:00 Tehran on this Jalali month's 1st", async () => {
    const report = await buildDashboardReport(new Date('2026-09-29T12:00:00Z'));

    // 1 Mehr 1405 began at 20:30 UTC on 22 Sep 2026.
    expect(dao.countCustomers).toHaveBeenCalledExactlyOnceWith(
      new Date('2026-09-22T20:30:00Z'),
    );
    expect(report.stats.newCustomersThisMonth).toBe(7);
  });
});
