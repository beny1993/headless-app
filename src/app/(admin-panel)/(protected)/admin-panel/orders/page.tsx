import type { Metadata } from 'next';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { z } from 'zod';
import { OrderDao } from '@/db/dao/OrderDao';
import { adminOrderPath } from '@/lib/constant/paths';
import { formatJalali, formatToman, toPersianDigits } from '@/lib/format';
import {
  ORDER_STATUS_VALUES,
  orderStatusSchema,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@/lib/orders/order-status';
import { orderStatusBadge } from '@/lib/orders/order-status-display';

export const metadata: Metadata = { title: 'سفارش‌ها' };

// Reads live orders per request (and depends on searchParams).
export const dynamic = 'force-dynamic';

// Page-level input degrades rather than 400s (the always-zod rule for pages): a
// bad `status` falls back to "no filter" via `.catch`, never throws.
const filterSchema = z.object({
  status: orderStatusSchema.optional().catch(undefined),
});

const methodLabel = (method: PaymentMethod): string =>
  method === PAYMENT_METHODS.COD ? 'پرداخت در محل' : 'زرین‌پال';

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = filterSchema.parse(await searchParams);
  const orders = await OrderDao.listForAdmin(filters.status);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black">سفارش‌ها</h1>

        {/* Native GET form — no client JS. Submitting reloads with the filter in
            the URL, which the server reads back above. */}
        <form method="get" className="flex items-center gap-2">
          <label htmlFor="filter-status" className="sr-only">
            فیلتر وضعیت سفارش
          </label>
          <select
            id="filter-status"
            name="status"
            defaultValue={filters.status ?? ''}
            className="border-border focus-visible:border-accent-strong h-11 rounded-xl border bg-white px-3 text-sm outline-none"
          >
            <option value="">همه وضعیت‌ها</option>
            {ORDER_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {orderStatusBadge(status).label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            data-umami-event="admin-panel-orders-filter"
            className="bg-ink shrink-0 rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-colors hover:opacity-90"
          >
            اعمال
          </button>
        </form>
      </div>

      <div className="border-border overflow-hidden rounded-2xl border bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50">
              <tr>
                {[
                  'شناسه',
                  'مشتری',
                  'تاریخ',
                  'مبلغ',
                  'پرداخت',
                  'وضعیت',
                  'روش پرداخت',
                  'عملیات',
                ].map((heading) => (
                  <th
                    key={heading}
                    className="text-muted-foreground px-4 py-3 text-start font-semibold"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="text-muted-foreground px-4 py-10 text-center"
                  >
                    سفارشی با این فیلتر پیدا نشد.
                  </td>
                </tr>
              ) : (
                orders.map((order) => {
                  const badge = orderStatusBadge(order.status);
                  return (
                    <tr
                      key={order.id}
                      className="border-border hover:bg-secondary/20 border-t transition-colors"
                    >
                      <td className="nums px-4 py-3.5 text-xs">
                        #{toPersianDigits(order.orderNo)}
                      </td>
                      <td className="px-4 py-3.5 font-medium">
                        {order.recipientName}
                      </td>
                      <td className="text-muted-foreground px-4 py-3.5 text-xs">
                        {formatJalali(order.createdAt)}
                      </td>
                      <td className="nums px-4 py-3.5 font-semibold">
                        {formatToman(order.total)}
                      </td>
                      <td className="px-4 py-3.5">
                        {order.isPaid ? (
                          <span className="bg-success-soft text-success-strong rounded-full px-2.5 py-1 text-xs font-medium">
                            پرداخت شده
                          </span>
                        ) : (
                          <span className="bg-secondary text-muted-foreground rounded-full px-2.5 py-1 text-xs font-medium">
                            پرداخت‌نشده
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.badge}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="text-muted-foreground px-4 py-3.5 text-xs">
                        {methodLabel(order.paymentMethod)}
                      </td>
                      <td className="px-4 py-3.5">
                        <Link
                          href={adminOrderPath(order.id)}
                          aria-label={`مشاهده سفارش ${toPersianDigits(order.orderNo)}`}
                          data-umami-event="admin-panel-orders-view"
                          className="hover:bg-secondary flex h-10 w-10 items-center justify-center rounded-lg transition-colors"
                        >
                          <Eye size={14} aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
