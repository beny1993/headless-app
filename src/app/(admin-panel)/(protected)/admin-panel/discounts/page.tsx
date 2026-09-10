import { requireAdmin } from '@/lib/auth/session';
import type { Metadata } from 'next';
import { DiscountCodeDao } from '@/db/dao/DiscountCodeDao';
import { DiscountManager } from '@/features/admin-panel/discounts/discount-manager';
import { toDiscountView } from '@/lib/hono/routes/admin-discounts';

export const metadata: Metadata = { title: 'کدهای تخفیف' };

// Reads live codes per request (usage counts move on every checkout).
export const dynamic = 'force-dynamic';

export default async function AdminDiscountsPage() {
  await requireAdmin();
  const codes = await DiscountCodeDao.listForAdmin();

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-black">کدهای تخفیف</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          کد تخفیف درصدی یا مبلغی بساز. مبلغ تخفیف هنگام ثبت سفارش روی خود سفارش
          ذخیره می‌شود؛ غیرفعال‌کردن یک کد، سفارش‌های قبلی را تغییر نمی‌دهد.
        </p>
      </div>
      <DiscountManager initialCodes={codes.map(toDiscountView)} />
    </div>
  );
}
