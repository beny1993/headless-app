import type { Metadata } from 'next';
import { formatToman } from '@/lib/format';
import { buildDashboardReport } from '@/logic/orders/dashboard-report';
import {
  countLabel,
  MonthlyBarChart,
} from '@/features/admin-panel/dashboard/monthly-bar-chart';
import { StatCards } from '@/features/admin-panel/dashboard/stat-cards';

export const metadata: Metadata = { title: 'داشبورد' };

// Reads live order aggregates per request.
export const dynamic = 'force-dynamic';

export default async function AdminPanelPage() {
  const report = await buildDashboardReport();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-black">داشبورد</h1>

      <StatCards stats={report.stats} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <MonthlyBarChart
          title="روند فروش (۶ ماه)"
          points={report.months.map((month) => ({
            label: month.label,
            value: month.revenue,
          }))}
          formatValue={formatToman}
        />
        <MonthlyBarChart
          title="تعداد سفارش‌ها (۶ ماه)"
          points={report.months.map((month) => ({
            label: month.label,
            value: month.orders,
          }))}
          formatValue={countLabel}
        />
      </div>
    </div>
  );
}
