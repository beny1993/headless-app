import { requireAdmin } from '@/lib/auth/session';
import type { Metadata } from 'next';
import { ShippingRateDao } from '@/db/dao/ShippingRateDao';
import { ShippingRatesEditor } from '@/features/admin-panel/shipping/shipping-rates-editor';

export const metadata: Metadata = { title: 'نرخ ارسال' };

// Reads live rates per request.
export const dynamic = 'force-dynamic';

export default async function AdminShippingPage() {
  await requireAdmin();
  const rates = await ShippingRateDao.list();

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-black">نرخ ارسال استان‌ها</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          هزینه ارسال هر استان به تومان. مبلغ هنگام ثبت سفارش روی خود سفارش
          ذخیره می‌شود؛ صفر یعنی ارسال رایگان.
        </p>
      </div>
      <ShippingRatesEditor rates={rates} />
    </div>
  );
}
