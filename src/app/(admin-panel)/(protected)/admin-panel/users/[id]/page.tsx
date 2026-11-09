import { requireAdmin } from '@/lib/auth/session';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { z } from 'zod';
import { ROLES } from '@/db/schema/auth';
import { adminOrderPath, PROTECTED_PATHS } from '@/lib/constant/paths';
import {
  formatJalali,
  formatNumber,
  formatToman,
  toPersianDigits,
} from '@/lib/format';
import { orderStatusBadge } from '@/lib/orders/order-status-display';
import { getAdminUser } from '@/logic/users/get-admin-user';
import { PaymentRow } from '@/features/admin-panel/orders/order-detail-rows';
import {
  NO_NAME,
  RolePill,
  userName,
  userPhone,
} from '@/features/admin-panel/users/user-display';

export const metadata: Metadata = { title: 'جزئیات کاربر' };

// Reads the live account per request.
export const dynamic = 'force-dynamic';

/**
 * The `[id]` segment is stranger input. User ids are text, not uuids: Better
 * Auth's are alphanumeric and `pnpm create-admin`'s are uuids. Anything else is
 * refused before the database, a NUL byte included, which `pg` would 500 on.
 */
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const CARD = 'border-border rounded-2xl border bg-white p-5';
const EMPTY = 'text-muted-foreground text-sm';

// Server-rendered throughout, deliberately: nothing read here is handed to a
// client component, so none of it rides along in the RSC payload.
export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) notFound();

  // Not owner-scoped: the page has authorized an admin to read any account.
  const detail = await getAdminUser(parsed.data);
  if (!detail) notFound();

  const { user, orders, addresses } = detail;
  const phone = userPhone(user.phoneNumber);

  return (
    <div className="max-w-4xl">
      <Link
        href={PROTECTED_PATHS.USERS}
        className="text-muted-foreground hover:text-foreground mb-5 flex items-center gap-2 text-sm"
        data-umami-event="admin-panel-user-back"
      >
        <ChevronRight size={14} aria-hidden="true" /> بازگشت به فهرست کاربران
      </Link>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-black">
          {userName(user.name) ?? NO_NAME}
        </h1>
        <RolePill admin={user.role === ROLES.ADMIN} />
      </div>

      {/* The profile column first in the DOM, so a phone reads the profile
          before the lists; at `lg` it sits at the start edge. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5">
          <section className={CARD}>
            <h2 className="mb-3 font-bold">مشخصات</h2>
            <div className="space-y-2.5 text-sm">
              <PaymentRow
                label="شماره موبایل"
                value={phone ?? '—'}
                ltr={Boolean(phone)}
              />
              <PaymentRow
                label="تاریخ عضویت"
                value={formatJalali(user.createdAt)}
              />
              <div className="border-border space-y-2.5 border-t pt-3">
                <PaymentRow
                  label="تعداد سفارش"
                  value={formatNumber(user.orderCount)}
                />
                <PaymentRow
                  label="مجموع خرید"
                  value={formatToman(user.totalSpent)}
                />
                <p className="text-muted-foreground text-xs">
                  مجموع خرید فقط سفارش‌های پرداخت‌شده و لغونشده را حساب می‌کند.
                </p>
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-5 lg:col-span-2">
          <section className={CARD}>
            <h2 className="mb-3 font-bold">سفارش‌ها</h2>
            {orders.length === 0 ? (
              <p className={EMPTY}>هنوز سفارشی ثبت نشده است.</p>
            ) : (
              <div className="divide-border divide-y">
                {orders.map((order) => {
                  const badge = orderStatusBadge(order.status);
                  return (
                    <Link
                      key={order.id}
                      href={adminOrderPath(order.id)}
                      data-umami-event="admin-panel-user-order-view"
                      className="hover:bg-secondary/20 flex items-center justify-between gap-3 rounded-lg py-3"
                    >
                      <div>
                        <p className="nums text-sm font-medium">
                          سفارش #{toPersianDigits(order.orderNo)}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {formatJalali(order.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col items-end gap-1">
                          <span className="nums text-sm font-bold whitespace-nowrap">
                            {formatToman(order.total)}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.badge}`}
                          >
                            {badge.label}
                          </span>
                        </div>
                        <ChevronLeft size={14} aria-hidden="true" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <section className={CARD}>
            <h2 className="mb-3 font-bold">آدرس‌ها</h2>
            {addresses.length === 0 ? (
              <p className={EMPTY}>هنوز آدرسی ذخیره نشده است.</p>
            ) : (
              <div className="divide-border divide-y">
                {addresses.map((address) => (
                  <div
                    key={address.id}
                    className="py-3 text-sm first:pt-0 last:pb-0"
                  >
                    <p className="mb-1 font-semibold">
                      {address.title ? `${address.title} — ` : ''}
                      {address.provinceName}
                    </p>
                    <p className="text-muted-foreground">
                      {address.recipientName} · {address.city}
                    </p>
                    <p className="text-muted-foreground break-words">
                      {address.addressLine}
                    </p>
                    <p className="text-muted-foreground nums">
                      کد پستی: {toPersianDigits(address.postalCode)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
