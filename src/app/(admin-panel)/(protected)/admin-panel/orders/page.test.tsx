// Pins how the admin orders list pages: the page and the status filter come
// from the URL, every page link keeps the status, rows are numbered on from the
// pages before, and a page past the end says so. The page renders for real with
// its DAO and the admin guard mocked at the module edge.
import { cleanup, render, screen, within } from '@testing-library/react';
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
  deliveryMethod: 'post',
  total: 250_000,
  createdAt: new Date('2026-09-01T10:00:00Z'),
  itemCount: 1,
  isPaid: true,
  hasCustomerNote: false,
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

  it('numbers rows on from the pages before', async () => {
    pageForAdmin.mockResolvedValue({
      items: [
        ORDER,
        { ...ORDER, id: '00000000-0000-4000-8000-000000000102', orderNo: 102 },
      ],
      total: ADMIN_PAGE_SIZE + 2,
    });

    await renderPage({ page: '2' });

    // Page two starts after one full page, as the DAO's offset does.
    const [, ...rows] = screen.getAllByRole('row');
    expect(
      rows.map((row) => within(row).getAllByRole('cell')[0].textContent),
    ).toEqual([
      formatNumber(ADMIN_PAGE_SIZE + 1),
      formatNumber(ADMIN_PAGE_SIZE + 2),
    ]);
  });

  it('says a page past the end is empty, and still links back', async () => {
    // Fewer matches than one page, so page 2 is already past the end.
    pageForAdmin.mockResolvedValue({ items: [], total: 3 });

    await renderPage({ page: '2' });

    expect(screen.getByText('این صفحه سفارشی ندارد.')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: `صفحه ${formatNumber(1)}` }),
    ).toBeTruthy();
  });
});

describe('admin orders delivery method', () => {
  it('marks a courier order, and only a courier order', async () => {
    pageForAdmin.mockResolvedValue({
      items: [
        ORDER,
        {
          ...ORDER,
          id: '00000000-0000-4000-8000-000000000102',
          orderNo: 102,
          recipientName: 'گیرنده پیک',
          deliveryMethod: 'courier',
        },
      ],
      total: 2,
    });

    await renderPage({});

    const rows = screen.getAllByRole('row');
    const courierRow = rows.find((row) =>
      row.textContent?.includes('گیرنده پیک'),
    )!;
    const postRow = rows.find((row) =>
      row.textContent?.includes('گیرنده آزمایشی'),
    )!;
    expect(courierRow.textContent).toContain('ارسال با پیک');
    expect(postRow.textContent).not.toContain('ارسال با پیک');
  });
});

describe('admin orders customer note', () => {
  it('flags an order whose shopper left a note, and only that one', async () => {
    pageForAdmin.mockResolvedValue({
      items: [
        ORDER,
        {
          ...ORDER,
          id: '00000000-0000-4000-8000-000000000103',
          orderNo: 103,
          recipientName: 'گیرنده با توضیح',
          hasCustomerNote: true,
        },
      ],
      total: 2,
    });

    await renderPage({});

    const rows = screen.getAllByRole('row');
    const noted = rows.find((row) =>
      row.textContent?.includes('گیرنده با توضیح'),
    )!;
    const plain = rows.find((row) =>
      row.textContent?.includes('گیرنده آزمایشی'),
    )!;
    expect(noted.textContent).toContain('توضیحات');
    expect(plain.textContent).not.toContain('توضیحات');
  });
});
