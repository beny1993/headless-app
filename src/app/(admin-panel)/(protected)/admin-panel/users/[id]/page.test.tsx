// Pins the admin user detail: a malformed or unknown id is a 404 before or
// instead of a read, the profile and the two lists show what the design
// lists with their own empty states, and nothing the page must never show
// (the email) reaches the markup. Renders for real with its
// read and the admin guard mocked at the module edge.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLES } from '@/db/schema/auth';
import { adminOrderPath, PROTECTED_PATHS } from '@/lib/constant/paths';
import {
  formatJalali,
  formatNumber,
  formatToman,
  toPersianDigits,
} from '@/lib/format';
import { ORDER_STATUSES, PAYMENT_METHODS } from '@/lib/orders/order-status';
import { orderStatusBadge } from '@/lib/orders/order-status-display';
import type { AdminUserDetail } from '@/logic/users/get-admin-user';
import AdminUserDetailPage from './page';

const { getAdminUser } = vi.hoisted(() => ({ getAdminUser: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/logic/users/get-admin-user', () => ({ getAdminUser }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));

const ID = 'aB3dE5gH7jK9mN1pQ3sT5vX7zA9cD1f';
const CREATED = new Date('2026-09-01T10:00:00Z');

const DETAIL: AdminUserDetail = {
  user: {
    id: ID,
    name: 'سارا محمدی',
    phoneNumber: '+989121234567',
    role: ROLES.CUSTOMER,
    createdAt: CREATED,
    orderCount: 2,
    totalSpent: 250_000,
  },
  orders: [
    {
      id: '00000000-0000-4000-8000-000000000102',
      orderNo: 102,
      status: ORDER_STATUSES.CANCELLED,
      paymentMethod: PAYMENT_METHODS.COD,
      total: 90_000,
      createdAt: new Date('2026-09-10T10:00:00Z'),
      itemCount: 1,
    },
    {
      id: '00000000-0000-4000-8000-000000000101',
      orderNo: 101,
      status: ORDER_STATUSES.PAID,
      paymentMethod: PAYMENT_METHODS.ZARINPAL,
      total: 250_000,
      createdAt: CREATED,
      itemCount: 2,
    },
  ],
  addresses: [
    {
      id: '00000000-0000-4000-8000-000000000201',
      title: 'خانه',
      recipientName: 'علی رضایی',
      provinceName: 'اصفهان',
      city: 'کاشان',
      addressLine: 'خیابان امیرکبیر، پلاک ۷',
      postalCode: '8715123456',
    },
  ],
};

beforeEach(() => {
  getAdminUser.mockResolvedValue(DETAIL);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderPage = async (id: string) =>
  render(await AdminUserDetailPage({ params: Promise.resolve({ id }) }));

const section = (heading: string) =>
  screen.getByRole('heading', { level: 2, name: heading }).closest('section')!;

describe('admin user detail: the id', () => {
  it.each([
    ['empty', ''],
    ['too long', 'a'.repeat(65)],
    ['a space', 'a b'],
    ['a NUL byte', `a${String.fromCharCode(0)}`],
    ['a path', '../orders'],
  ])('is a 404 for %s, before any read', async (_label, id) => {
    await expect(renderPage(id)).rejects.toThrow('NOT_FOUND');
    expect(getAdminUser).not.toHaveBeenCalled();
  });

  it.each([
    ['a Better Auth id', ID],
    ['a create-admin uuid', '00000000-0000-4000-8000-000000000001'],
  ])('reads %s', async (_label, id) => {
    await renderPage(id);
    expect(getAdminUser).toHaveBeenCalledWith(id);
  });

  it('is a 404 for an id nobody has', async () => {
    getAdminUser.mockResolvedValue(null);
    await expect(renderPage(ID)).rejects.toThrow('NOT_FOUND');
  });
});

describe('admin user detail: the profile', () => {
  it('shows the name, the role and a back link', async () => {
    await renderPage(ID);

    expect(
      screen.getByRole('heading', { level: 1, name: 'سارا محمدی' }),
    ).toBeTruthy();
    expect(screen.getByText('مشتری')).toBeTruthy();
    const back = screen.getByRole('link', { name: 'بازگشت به فهرست کاربران' });
    expect(back.getAttribute('href')).toBe(PROTECTED_PATHS.USERS);
    expect(back.getAttribute('data-umami-event')).toBe('admin-panel-user-back');
  });

  it('shows the phone LTR, the join date, the order count and the spend', async () => {
    await renderPage(ID);

    const card = section('مشخصات');
    const phone = within(card).getByText(toPersianDigits('09121234567'));
    expect(phone.getAttribute('dir')).toBe('ltr');
    for (const text of [
      formatJalali(CREATED),
      formatNumber(2),
      formatToman(250_000),
      'مجموع خرید فقط سفارش‌های پرداخت‌شده و لغونشده را حساب می‌کند.',
    ]) {
      expect(within(card).getByText(text)).toBeTruthy();
    }
  });

  it('falls back for a blank name and a missing phone, and pills an admin', async () => {
    getAdminUser.mockResolvedValue({
      ...DETAIL,
      user: { ...DETAIL.user, name: '  ', phoneNumber: null, role: 'admin' },
    });

    await renderPage(ID);

    expect(
      screen.getByRole('heading', { level: 1, name: 'بدون نام' }),
    ).toBeTruthy();
    expect(screen.getByText('مدیر')).toBeTruthy();
    expect(within(section('مشخصات')).getByText('—')).toBeTruthy();
  });

  it('never renders an email, even one that reached the page', async () => {
    const email = '989121234567@phone.smokey.invalid';
    getAdminUser.mockResolvedValue({
      ...DETAIL,
      user: { ...DETAIL.user, email },
    });

    const { container } = await renderPage(ID);

    expect(container.innerHTML).not.toContain(email);
  });
});

describe('admin user detail: the lists', () => {
  it('links every order, newest first, to its admin page', async () => {
    await renderPage(ID);

    const links = within(section('سفارش‌ها')).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      adminOrderPath(DETAIL.orders[0].id),
      adminOrderPath(DETAIL.orders[1].id),
    ]);
    expect(
      links.every(
        (link) =>
          link.getAttribute('data-umami-event') ===
          'admin-panel-user-order-view',
      ),
    ).toBe(true);
    expect(links[0].textContent).toContain(`سفارش #${toPersianDigits(102)}`);
    expect(links[0].textContent).toContain(formatToman(90_000));
    expect(links[0].textContent).toContain(
      orderStatusBadge(ORDER_STATUSES.CANCELLED).label,
    );
  });

  it('shows each address as the account book reads it', async () => {
    await renderPage(ID);

    const card = section('آدرس‌ها');
    for (const text of [
      'خانه — اصفهان',
      'علی رضایی · کاشان',
      'خیابان امیرکبیر، پلاک ۷',
      `کد پستی: ${toPersianDigits('8715123456')}`,
    ]) {
      expect(within(card).getByText(text)).toBeTruthy();
    }
  });

  it('says so when a list is empty', async () => {
    getAdminUser.mockResolvedValue({
      ...DETAIL,
      orders: [],
      addresses: [],
    });

    await renderPage(ID);

    expect(
      within(section('سفارش‌ها')).getByText('هنوز سفارشی ثبت نشده است.'),
    ).toBeTruthy();
    expect(
      within(section('آدرس‌ها')).getByText('هنوز آدرسی ذخیره نشده است.'),
    ).toBeTruthy();
  });
});
