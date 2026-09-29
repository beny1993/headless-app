import {
  BarChart2,
  Clock,
  ShoppingCart,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { DashboardStats } from '@/logic/orders/dashboard-report';
import { cn } from '@/lib/utils';
import { formatNumber, formatToman, toPersianDigits } from '@/lib/format';

/**
 * The dashboard's top-line tiles, from real aggregates (see buildDashboardReport).
 * Every value goes through `@/lib/format`, and money is the integer Toman the
 * DAO summed — never a float. «درآمد» counts only booked-and-paid orders, so a
 * store with no settled sales shows ۰, not a fabricated figure.
 */
export function StatCards({ stats }: { stats: DashboardStats }) {
  const tiles = [
    {
      label: 'درآمد کل',
      value: formatToman(stats.totalRevenue),
      icon: TrendingUp,
      color: 'text-success-strong',
    },
    {
      label: 'سفارش‌های پرداخت‌شده',
      value: toPersianDigits(stats.paidOrderCount),
      icon: ShoppingCart,
      color: 'text-accent-strong',
    },
    {
      label: 'میانگین ارزش سفارش',
      value: formatToman(stats.averageOrderValue),
      icon: BarChart2,
      color: 'text-tan-strong',
    },
    {
      label: 'در انتظار پردازش',
      value: toPersianDigits(stats.awaitingProcessing),
      icon: Clock,
      color: 'text-warning',
    },
    {
      // This Jalali month, said in the label: the four tiles above are
      // all-time, and a tile has no sub-line to name its window.
      label: 'مشتریان جدید این ماه',
      value: formatNumber(stats.newCustomersThisMonth),
      icon: Users,
      color: 'text-info',
      // Two across at a phone's width leave the fifth alone on its row.
      span: 'col-span-2 md:col-span-1',
    },
  ];

  // Three across from `md` until `2xl`: at 1280 five tiles would leave ~150px
  // each, and «۱۲٬۴۵۰٬۰۰۰ تومان» at text-2xl would wrap.
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-5">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        return (
          <div
            key={tile.label}
            className={cn(
              'border-border rounded-2xl border bg-white p-5',
              tile.span,
            )}
          >
            <div
              className={`bg-secondary mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${tile.color}`}
            >
              <Icon size={18} aria-hidden="true" />
            </div>
            <p className="mb-0.5 text-2xl font-black">{tile.value}</p>
            <p className="text-muted-foreground text-xs">{tile.label}</p>
          </div>
        );
      })}
    </div>
  );
}
