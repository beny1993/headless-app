import { requireAdmin } from '@/lib/auth/session';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { z } from 'zod';
import { ROLES } from '@/db/schema/auth';
import { Pagination } from '@/components/ui/pagination';
import { UserDao } from '@/db/dao/UserDao';
import { adminUserPath, PROTECTED_PATHS } from '@/lib/constant/paths';
import {
  formatJalali,
  formatNumber,
  formatToman,
  jalaliMonthStart,
  toPersianDigits,
} from '@/lib/format';
import { ADMIN_PAGE_SIZE, pageParamSchema } from '@/lib/pagination';
import {
  MAX_USER_SEARCH_LENGTH,
  userSearchSchema,
} from '@/lib/users/user-search';
import { cn } from '@/lib/utils';
import { AdminTable } from '@/features/admin-panel/shared/admin-table';
import {
  NO_NAME,
  RolePill,
  userName,
  userPhone,
} from '@/features/admin-panel/users/user-display';

export const metadata: Metadata = { title: 'کاربران' };

// Reads live accounts per request (and depends on searchParams).
export const dynamic = 'force-dynamic';

// Page-level input degrades rather than 400s (the always-zod rule for pages): a
// blank, over-long or control-character search reads as no search, and a bad
// page as the first, via `.catch`. Never a throw.
const filterSchema = z.object({
  q: userSearchSchema.optional().catch(undefined),
  page: pageParamSchema,
});

type UserFilters = z.infer<typeof filterSchema>;

/** The list's URL for one page, keeping the search; page one has no `page`. */
const usersHref = (filters: UserFilters, page: number): string => {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (page > 1) params.set('page', String(page));
  const search = params.toString();
  return search ? `${PROTECTED_PATHS.USERS}?${search}` : PROTECTED_PATHS.USERS;
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const filters = filterSchema.parse(await searchParams);
  // Customers only in both counts: admins are made by the CLI and do not
  // «join». So the table, which lists admins too, has more rows than
  // «کل مشتریان» by the number of admins.
  const [{ items: users, total }, customerCount, newThisMonth] =
    await Promise.all([
      UserDao.pageForAdmin({
        search: filters.q,
        page: filters.page,
        limit: ADMIN_PAGE_SIZE,
      }),
      UserDao.countCustomers(),
      UserDao.countCustomers(jalaliMonthStart(new Date())),
    ]);
  const totalPages = Math.ceil(total / ADMIN_PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-black">کاربران</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {(
          [
            ['کل مشتریان', customerCount],
            ['مشتریان جدید این ماه', newThisMonth],
          ] as const
        ).map(([label, value]) => (
          <div
            key={label}
            className="border-border rounded-2xl border bg-white p-5"
          >
            <p className="text-2xl font-black">{formatNumber(value)}</p>
            <p className="text-muted-foreground text-sm">{label}</p>
          </div>
        ))}
      </div>

      {/* Below the cards, so they plainly do not follow the search. A native
          GET form keyed by its href, for the reason the orders list gives: a
          client-side move back to this list would otherwise leave the box
          showing, and re-submitting, a search the list no longer applies. */}
      <form
        key={usersHref(filters, 1)}
        method="get"
        className="flex max-w-md gap-2"
      >
        <label htmlFor="filter-q" className="sr-only">
          جستجوی کاربر با نام یا شماره موبایل
        </label>
        <input
          id="filter-q"
          name="q"
          type="search"
          enterKeyHint="search"
          maxLength={MAX_USER_SEARCH_LENGTH}
          defaultValue={filters.q ?? ''}
          placeholder={`نام یا شماره موبایل (مثل ${toPersianDigits('0912')}…)`}
          data-umami-event="admin-panel-users-search-type"
          className="border-border focus-visible:border-accent-strong focus-visible:ring-ring h-11 min-w-0 flex-1 rounded-xl border bg-white px-4 text-sm outline-none focus-visible:ring-2"
        />
        <button
          type="submit"
          data-umami-event="admin-panel-users-search-submit"
          className="bg-ink h-11 shrink-0 rounded-xl px-4 text-sm font-medium text-white transition-colors hover:opacity-90"
        >
          جستجو
        </button>
      </form>

      {users.length === 0 ? (
        // Outside the table, not a `colSpan` cell: inside the table's own
        // horizontal scroller a phone centres it off-screen, «نمایش همه
        // کاربران» included.
        <p className="border-border text-muted-foreground rounded-2xl border bg-white px-4 py-10 text-center text-sm wrap-break-word">
          {/* With no search the list is never empty: the admin reading it is
              a row. So empty means past the end, or no match. */}
          {total > 0 ? (
            'این صفحه کاربری ندارد.'
          ) : (
            <>
              کاربری با «<bdi>{filters.q}</bdi>» پیدا نشد.{' '}
              <Link
                href={PROTECTED_PATHS.USERS}
                data-umami-event="admin-panel-users-search-clear"
                className="text-accent-strong font-medium underline"
              >
                نمایش همه کاربران
              </Link>
            </>
          )}
        </p>
      ) : (
        <AdminTable
          headings={[
            'ردیف',
            'نام',
            'نقش',
            'شماره موبایل',
            'تعداد سفارش',
            'مجموع خرید',
            'تاریخ عضویت',
            'عملیات',
          ]}
        >
          {users.map((user, index) => {
            const name = userName(user.name);
            const phone = userPhone(user.phoneNumber);
            return (
              <tr
                key={user.id}
                className="border-border hover:bg-secondary/20 border-t transition-colors"
              >
                <td className="text-muted-foreground nums px-4 py-3.5 text-xs">
                  {/* The DAO's own offset, so numbering carries on across pages. */}
                  {formatNumber(
                    (filters.page - 1) * ADMIN_PAGE_SIZE + index + 1,
                  )}
                </td>
                <td
                  className={cn(
                    'max-w-xs px-4 py-3.5 font-medium',
                    !name && 'text-muted-foreground',
                  )}
                >
                  <p className="line-clamp-2">{name ?? NO_NAME}</p>
                </td>
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <RolePill admin={user.role === ROLES.ADMIN} />
                </td>
                <td className="text-muted-foreground px-4 py-3.5 text-xs whitespace-nowrap">
                  {phone ? (
                    <span dir="ltr" className="nums">
                      {phone}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="nums px-4 py-3.5">
                  {formatNumber(user.orderCount)}
                </td>
                <td className="nums px-4 py-3.5 font-semibold whitespace-nowrap">
                  {formatToman(user.totalSpent)}
                </td>
                <td className="text-muted-foreground px-4 py-3.5 text-xs whitespace-nowrap">
                  {formatJalali(user.createdAt)}
                </td>
                <td className="px-4 py-3.5">
                  <Link
                    href={adminUserPath(user.id)}
                    // The phone as well: most phone sign-ups have no name, and
                    // «مشاهده کاربر بدون نام» on every row names none of them.
                    aria-label={`مشاهده کاربر ${name ?? NO_NAME}${phone ? ` ${phone}` : ''}`}
                    data-umami-event="admin-panel-users-view"
                    className="hover:bg-secondary flex h-10 w-10 items-center justify-center rounded-lg transition-colors"
                  >
                    <Eye size={14} aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            );
          })}
        </AdminTable>
      )}

      <Pagination
        page={filters.page}
        totalPages={totalPages}
        hrefFor={(page) => usersHref(filters, page)}
        label="صفحه‌بندی کاربران"
        event="admin-panel-users-pagination"
      />
    </div>
  );
}
