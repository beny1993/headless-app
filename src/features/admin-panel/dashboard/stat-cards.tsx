import { BarChart2, Clock, ShoppingCart, TrendingUp } from 'lucide-react';
import type { DashboardStats } from '@/logic/orders/dashboard-report';
import { formatToman, toPersianDigits } from '@/lib/format';

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
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        return (
          <div
            key={tile.label}
            className="border-border rounded-2xl border bg-white p-5"
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
