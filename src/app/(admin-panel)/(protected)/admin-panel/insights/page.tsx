import { requireAdmin } from '@/lib/auth/session';
import type { Metadata } from 'next';
import { z } from 'zod';
import { insightWindowSchema } from '@/lib/insights/window';
import { loadProductInsights } from '@/logic/admin/product-insights';
import {
  ActionList,
  GroupTable,
  InsightTiles,
  ProductTable,
  SourceList,
  ViewsNotice,
  WindowSwitch,
} from '@/features/admin-panel/insights/insight-sections';

export const metadata: Metadata = { title: 'پرطرفدارها' };

// Reads live orders and Umami per request (and depends on searchParams).
export const dynamic = 'force-dynamic';

// A bad `?days` reads as the default window, never an error.
const filterSchema = z.object({ days: insightWindowSchema });

export default async function AdminInsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { days } = filterSchema.parse(await searchParams);
  const report = await loadProductInsights(days);
  const withViews = report.viewsStatus === 'ok';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-black">پرطرفدارها</h1>
        <p className="text-muted-foreground text-sm">
          فروش از سفارش‌های پرداخت‌شده، بازدید از آمار Umami.
        </p>
      </div>

      <WindowSwitch current={days} />
      <ViewsNotice status={report.viewsStatus} />
      <InsightTiles totals={report.totals} />

      {withViews && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ActionList
            title="زیاد دیده، کم فروخته"
            hint="دیده شده ولی در این بازه فروشی نداشته؛ قیمت، عکس یا توضیحش را نگاه کنید."
            empty="هر محصولی که دیده شده، فروش هم داشته."
            products={report.seenNotSold}
            event="admin-panel-insights-seen-not-sold-open"
          />
          <ActionList
            title="ناموجود ولی پرتقاضا"
            hint="موجودی‌اش تمام شده ولی هنوز بازدید دارد؛ برای شارژ دوباره."
            empty="محصول ناموجودی که بازدید داشته باشد نیست."
            products={report.soldOutWanted}
            event="admin-panel-insights-sold-out-open"
          />
        </div>
      )}

      <ProductTable products={report.products} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <GroupTable
          title="دسته‌ها"
          heading="دسته"
          hint="بر اساس دسته اصلی هر محصول."
          groups={report.categories}
        />
        <GroupTable
          title="گربه و سگ"
          heading="حیوان"
          hint="محصولی که برای هر دو است، زیر هر دو شمرده می‌شود."
          groups={report.pets}
        />
      </div>

      {report.sources && <SourceList sources={report.sources} />}
    </div>
  );
}
