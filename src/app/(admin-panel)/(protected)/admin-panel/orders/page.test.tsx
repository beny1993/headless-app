// Pins how the admin orders list pages: the page and the status filter come
// from the URL, every page link keeps the status, and a page past the end says
// so. The page renders for real with its DAO and the admin guard mocked at the
// module edge.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminOrderRow } from '@/db/dao/OrderDao';
import { PROTECTED_PATHS } from '@/lib/constant/paths';
import { formatNumber } from '@/lib/format';
import { ORDER_STATUSES, PAYMENT_METHODS } from '@/lib/orders/order-status';
import { ADMIN_PAGE_SIZE } from '@/lib/pagination';
import AdminOrdersPage from './page';

const { pageForAdmin } = vi.hoisted(() => ({ pageForAdmin: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/db/dao/OrderDao', () => ({ OrderDao: { pageForAdmin } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ORDER: AdminOrderRow = {
  id: '00000000-0000-4000-8000-000000000101',
  orderNo: 101,
  recipientName: 'گیرنده آزمایشی',
  status: ORDER_STATUSES.PAID,
  paymentMethod: PAYMENT_METHODS.ZARINPAL,
  total: 250_000,
  createdAt: new Date('2026-09-01T10:00:00Z'),
  itemCount: 1,
  isPaid: true,
};

const renderPage = async (searchParams: Record<string, string>) =>
  render(
    await AdminOrdersPage({ searchParams: Promise.resolve(searchParams) }),
  );

/** A link's target as a URL, so query order and encoding do not matter. */
const target = (name: string) =>
  new URL(
    screen.getByRole('link', { name }).getAttribute('href')!,
    'http://localhost',
  );

describe('admin orders paging', () => {
  it('asks for the page in the URL and keeps the status on every page link', async () => {
    pageForAdmin.mockResolvedValue({
      items: [ORDER],
      total: ADMIN_PAGE_SIZE * 3,
    });

    await renderPage({ status: ORDER_STATUSES.PAID, page: '2' });

    expect(pageForAdmin).toHaveBeenCalledWith({
      status: ORDER_STATUSES.PAID,
      page: 2,
      limit: ADMIN_PAGE_SIZE,
    });
    const next = target('صفحه بعد');
    expect(next.pathname).toBe(PROTECTED_PATHS.ORDERS);
    expect(Object.fromEntries(next.searchParams)).toEqual({
      status: ORDER_STATUSES.PAID,
      page: '3',
    });
    expect(Object.fromEntries(target('صفحه قبل').searchParams)).toEqual({
      status: ORDER_STATUSES.PAID,
    });
    expect(
      screen
        .getByRole('link', { name: `صفحه ${formatNumber(2)}` })
        .getAttribute('aria-current'),
    ).toBe('page');
  });

  it('reads a malformed page as the first and shows no pager for one page', async () => {
    pageForAdmin.mockResolvedValue({ items: [ORDER], total: 1 });

    await renderPage({ page: '-1' });

    expect(pageForAdmin).toHaveBeenCalledWith({
      status: undefined,
      page: 1,
      limit: ADMIN_PAGE_SIZE,
    });
    expect(screen.queryByRole('link', { name: 'صفحه بعد' })).toBeNull();
  });

  it('says a page past the end is empty, and still links back', async () => {
    pageForAdmin.mockResolvedValue({ items: [], total: ADMIN_PAGE_SIZE + 1 });

    await renderPage({ page: '9' });

    expect(screen.getByText('این صفحه سفارشی ندارد.')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: `صفحه ${formatNumber(1)}` }),
    ).toBeTruthy();
  });
});
