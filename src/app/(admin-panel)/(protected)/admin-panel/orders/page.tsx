import { requireAdmin } from '@/lib/auth/session';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { z } from 'zod';
import { Pagination } from '@/components/ui/pagination';
import { OrderDao } from '@/db/dao/OrderDao';
import { adminOrderPath, PROTECTED_PATHS } from '@/lib/constant/paths';
import {
  formatJalali,
  formatNumber,
  formatToman,
  toPersianDigits,
} from '@/lib/format';
import {
  ORDER_STATUS_VALUES,
  orderStatusSchema,
  PAYMENT_METHOD_LABELS,
  type OrderStatus,
} from '@/lib/orders/order-status';
import { orderStatusBadge } from '@/lib/orders/order-status-display';
import { ADMIN_PAGE_SIZE, pageParamSchema } from '@/lib/pagination';
import { AdminTable } from '@/features/admin-panel/shared/admin-table';
import { Pill } from '@/features/admin-panel/shared/pill';

export const metadata: Metadata = { title: 'سفارش‌ها' };

// Reads live orders per request (and depends on searchParams).
export const dynamic = 'force-dynamic';

// Page-level input degrades rather than 400s (the always-zod rule for pages): a
// bad `status` falls back to "no filter" via `.catch`, never throws.
const filterSchema = z.object({
  status: orderStatusSchema.optional().catch(undefined),
  page: pageParamSchema,
});

/** The list's URL for one page, keeping the status; page one has no `page`. */
const ordersHref = (status: OrderStatus | undefined, page: number): string => {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (page > 1) params.set('page', String(page));
  const search = params.toString();
  return search
    ? `${PROTECTED_PATHS.ORDERS}?${search}`
    : PROTECTED_PATHS.ORDERS;
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const filters = filterSchema.parse(await searchParams);
  const { items: orders, total } = await OrderDao.pageForAdmin({
    status: filters.status,
    page: filters.page,
    limit: ADMIN_PAGE_SIZE,
  });
  const totalPages = Math.ceil(total / ADMIN_PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black">سفارش‌ها</h1>

        {/* Native GET form — no client JS. Submitting reloads with the filter in
            the URL, which the server reads back above. Keyed by that filter: a
            client-side move back to this list (the sidebar link) updates the
            page in place, and React never re-applies a mounted <select>'s
            changed `defaultValue`, so the form would keep showing — and
            re-submit — a filter the list no longer applies. */}
        <form
          key={ordersHref(filters.status, 1)}
          method="get"
          className="flex items-center gap-2"
        >
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

      <AdminTable
        headings={[
          'ردیف',
          'شناسه',
          'مشتری',
          'تاریخ',
          'مبلغ',
          'پرداخت',
          'وضعیت',
          'روش پرداخت',
          'عملیات',
        ]}
      >
        {orders.length === 0 ? (
          <tr>
            <td
              colSpan={9}
              className="text-muted-foreground px-4 py-10 text-center"
            >
              {/* Past the last page is not the same as nothing matching:
                 the pager below still links back. */}
              {total > 0
                ? 'این صفحه سفارشی ندارد.'
                : 'سفارشی با این فیلتر پیدا نشد.'}
            </td>
          </tr>
        ) : (
          orders.map((order, index) => {
            const badge = orderStatusBadge(order.status);
            return (
              <tr
                key={order.id}
                className="border-border hover:bg-secondary/20 border-t transition-colors"
              >
                <td className="text-muted-foreground nums px-4 py-3.5 text-xs">
                  {/* The DAO's own offset, so numbering carries on across pages. */}
                  {formatNumber(
                    (filters.page - 1) * ADMIN_PAGE_SIZE + index + 1,
                  )}
                </td>
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
                  <Pill tone={order.isPaid ? 'success' : 'muted'}>
                    {order.isPaid ? 'پرداخت شده' : 'پرداخت‌نشده'}
                  </Pill>
                </td>
                <td className="px-4 py-3.5">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.badge}`}
                  >
                    {badge.label}
                  </span>
                </td>
                <td className="text-muted-foreground px-4 py-3.5 text-xs">
                  {PAYMENT_METHOD_LABELS[order.paymentMethod]}
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
      </AdminTable>

      <Pagination
        page={filters.page}
        totalPages={totalPages}
        hrefFor={(page) => ordersHref(filters.status, page)}
        label="صفحه‌بندی سفارش‌ها"
        event="admin-panel-orders-pagination"
      />
    </div>
  );
}
