// Pins the admin users list: search and page come from the URL and degrade
// rather than fail, every row shows what the design lists (and never the
// email), the two customer counts read from 00:00 Tehran on this Jalali month's
// 1st, and a search with no hits says so with a way back. Renders for real
// with its DAO and the admin guard mocked at the module edge.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminUserRow } from '@/db/dao/UserDao';
import { ROLES } from '@/db/schema/auth';
import { adminUserPath, PROTECTED_PATHS } from '@/lib/constant/paths';
import {
  formatJalali,
  formatNumber,
  formatToman,
  toPersianDigits,
} from '@/lib/format';
import { ADMIN_PAGE_SIZE } from '@/lib/pagination';
import { MAX_USER_SEARCH_LENGTH } from '@/lib/users/user-search';
import AdminUsersPage from './page';

const dao = vi.hoisted(() => ({
  pageForAdmin: vi.fn(),
  countCustomers: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/db/dao/UserDao', () => ({ UserDao: dao }));

const CUSTOMER: AdminUserRow = {
  id: 'cust0001',
  name: 'سارا محمدی',
  phoneNumber: '+989121234567',
  role: ROLES.CUSTOMER,
  createdAt: new Date('2026-09-01T10:00:00Z'),
  orderCount: 3,
  totalSpent: 0,
};

const ADMIN: AdminUserRow = {
  ...CUSTOMER,
  id: 'admin0001',
  name: '',
  phoneNumber: null,
  role: ROLES.ADMIN,
  orderCount: 0,
  totalSpent: 1_250_000,
};

beforeEach(() => {
  dao.pageForAdmin.mockResolvedValue({ items: [CUSTOMER, ADMIN], total: 2 });
  dao.countCustomers.mockResolvedValue(0);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const renderPage = async (searchParams: Record<string, string | string[]>) =>
  render(await AdminUsersPage({ searchParams: Promise.resolve(searchParams) }));

/** A link's target as a URL, so query order and encoding do not matter. */
const target = (name: string) =>
  new URL(
    screen.getByRole('link', { name }).getAttribute('href')!,
    'http://localhost',
  );

const searchBox = () =>
  screen.getByRole('searchbox', {
    name: 'جستجوی کاربر با نام یا شماره موبایل',
  }) as HTMLInputElement;

describe('admin users: URL', () => {
  it('asks for the search and page in the URL, and keeps the search on every page link', async () => {
    dao.pageForAdmin.mockResolvedValue({
      items: [CUSTOMER],
      total: ADMIN_PAGE_SIZE * 3,
    });

    await renderPage({ q: '0912', page: '2' });

    expect(dao.pageForAdmin).toHaveBeenCalledWith({
      search: '0912',
      page: 2,
      limit: ADMIN_PAGE_SIZE,
    });
    const next = target('صفحه بعد');
    expect(next.pathname).toBe(PROTECTED_PATHS.USERS);
    expect(Object.fromEntries(next.searchParams)).toEqual({
      q: '0912',
      page: '3',
    });
    expect(Object.fromEntries(target('صفحه قبل').searchParams)).toEqual({
      q: '0912',
    });
    expect(searchBox().value).toBe('0912');
  });

  it.each([['0'], ['-1'], ['abc'], ['1e20'], ['2.5']])(
    'reads page %s as the first',
    async (page) => {
      await renderPage({ page });

      expect(dao.pageForAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1 }),
      );
    },
  );

  it.each([
    ['too long', 'a'.repeat(MAX_USER_SEARCH_LENGTH + 1)],
    ['blank', '   '],
    ['a NUL byte', `a${String.fromCharCode(0)}`],
    ['repeated', ['a', 'b']],
  ])('reads a %s search as no search', async (_label, q) => {
    await renderPage({ q });

    expect(dao.pageForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ search: undefined }),
    );
    expect(searchBox().value).toBe('');
  });

  it('bounds the box by the length the URL accepts', async () => {
    await renderPage({});

    expect(searchBox().maxLength).toBe(MAX_USER_SEARCH_LENGTH);
    expect(searchBox().getAttribute('data-umami-event')).toBe(
      'admin-panel-users-search-type',
    );
  });
});

describe('admin users: counts', () => {
  it('counts every customer, and those since 00:00 Tehran on this Jalali 1st', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    dao.countCustomers.mockImplementation(async (since?: Date) =>
      since ? 64 : 1245,
    );

    await renderPage({});

    // 1 Mehr 1405 began at 20:30 UTC on 22 Sep 2026.
    expect(dao.countCustomers).toHaveBeenCalledWith();
    expect(dao.countCustomers).toHaveBeenCalledWith(
      new Date('2026-09-22T20:30:00Z'),
    );
    const card = (label: string) => screen.getByText(label).parentElement!;
    expect(card('کل مشتریان').textContent).toContain(formatNumber(1245));
    expect(card('مشتریان جدید این ماه').textContent).toContain(
      formatNumber(64),
    );
  });
});

describe('admin users: rows', () => {
  const rowOf = (id: string) =>
    screen
      .getAllByRole('row')
      .find((row) =>
        row
          .querySelector('[data-umami-event="admin-panel-users-view"]')
          ?.getAttribute('href')
          ?.endsWith(adminUserPath(id)),
      )!;

  it('shows a customer: name, role, local phone LTR, counts, spend, join date', async () => {
    await renderPage({});

    const cells = within(rowOf(CUSTOMER.id)).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toEqual([
      formatNumber(1),
      'سارا محمدی',
      'مشتری',
      toPersianDigits('09121234567'),
      formatNumber(3),
      formatToman(0),
      formatJalali(CUSTOMER.createdAt),
      '',
    ]);
    // The digit run is isolated LTR inside a cell that stays RTL.
    expect(cells[3].getAttribute('dir')).toBeNull();
    expect(cells[3].querySelector('[dir="ltr"]')?.textContent).toBe(
      toPersianDigits('09121234567'),
    );
  });

  it('falls back for a blank name and a missing phone, and pills the admin', async () => {
    await renderPage({});

    const cells = within(rowOf(ADMIN.id)).getAllByRole('cell');
    expect(cells[1].textContent).toBe('بدون نام');
    expect(cells[2].textContent).toBe('مدیر');
    expect(cells[3].textContent).toBe('—');
    expect(cells[5].textContent).toBe(formatToman(1_250_000));
  });

  it('names every view link by the user and their phone', async () => {
    await renderPage({});

    const views = screen
      .getAllByRole('link')
      .filter(
        (link) =>
          link.getAttribute('data-umami-event') === 'admin-panel-users-view',
      );
    expect(views.map((link) => link.getAttribute('aria-label'))).toEqual([
      `مشاهده کاربر سارا محمدی ${toPersianDigits('09121234567')}`,
      'مشاهده کاربر بدون نام',
    ]);
    expect(views.map((link) => link.getAttribute('href'))).toEqual([
      adminUserPath(CUSTOMER.id),
      adminUserPath(ADMIN.id),
    ]);
  });

  it('never renders an email, even one that reached the row', async () => {
    const email = '989121234567@phone.invalid';
    dao.pageForAdmin.mockResolvedValue({
      items: [{ ...CUSTOMER, email }],
      total: 1,
    });

    const { container } = await renderPage({});

    expect(container.innerHTML).not.toContain(email);
  });
});

describe('admin users: empty', () => {
  it('says a search found nobody, keeps it in the box, and links back', async () => {
    dao.pageForAdmin.mockResolvedValue({ items: [], total: 0 });

    await renderPage({ q: 'ناشناس' });

    const cell = screen.getByText(/پیدا نشد/);
    expect(cell.textContent).toContain('کاربری با «ناشناس» پیدا نشد.');
    expect(cell.querySelector('bdi')?.textContent).toBe('ناشناس');
    const back = screen.getByRole('link', { name: 'نمایش همه کاربران' });
    expect(back.getAttribute('href')).toBe(PROTECTED_PATHS.USERS);
    expect(back.getAttribute('data-umami-event')).toBe(
      'admin-panel-users-search-clear',
    );
    expect(searchBox().value).toBe('ناشناس');
  });

  it('says a page past the end is empty, and still links back', async () => {
    dao.pageForAdmin.mockResolvedValue({ items: [], total: 3 });

    await renderPage({ page: '2' });

    expect(screen.getByText('این صفحه کاربری ندارد.')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: `صفحه ${formatNumber(1)}` }),
    ).toBeTruthy();
  });
});
