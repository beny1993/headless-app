import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATHS, PROTECTED_PATHS } from '@/lib/constant/paths';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  read: vi.fn(() => {
    throw new Error('AUTHORIZED_DATA_READ');
  }),
}));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/lib/auth/index', () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock('@/db/dao/CategoryDao', () => ({ CategoryDao: { list: mocks.read } }));
vi.mock('@/db/dao/ProductDao', () => ({
  ProductDao: {
    listForAdmin: mocks.read,
    pageForAdmin: mocks.read,
    findByIdForAdmin: mocks.read,
  },
}));
vi.mock('@/db/dao/OrderDao', () => ({
  OrderDao: { pageForAdmin: mocks.read },
}));
vi.mock('@/db/dao/DiscountCodeDao', () => ({
  DiscountCodeDao: { listForAdmin: mocks.read },
}));
vi.mock('@/db/dao/ShippingRateDao', () => ({
  ShippingRateDao: { list: mocks.read },
}));
vi.mock('@/db/dao/SiteContentDao', () => ({
  SiteContentDao: { getMany: mocks.read },
}));
vi.mock('@/logic/admin/product-removal', () => ({
  hardDeleteBlockers: mocks.read,
}));
vi.mock('@/logic/orders/dashboard-report', () => ({
  buildDashboardReport: mocks.read,
}));
vi.mock('@/logic/orders/get-admin-order', () => ({
  getAdminOrder: mocks.read,
}));
vi.mock('@/db/dao/UserDao', () => ({
  UserDao: { pageForAdmin: mocks.read, countCustomers: mocks.read },
}));
vi.mock('@/logic/users/get-admin-user', () => ({
  getAdminUser: mocks.read,
}));
vi.mock('@/logic/admin/product-insights', () => ({
  loadProductInsights: mocks.read,
}));

const id = '00000000-0000-4000-8000-000000000001';
const pageModules = import.meta.glob('./admin-panel/**/page.tsx');
const pages = [
  [
    './admin-panel/page.tsx',
    'dashboard',
    async () => (await import('./admin-panel/page')).default(),
  ],
  [
    './admin-panel/orders/page.tsx',
    'orders',
    async () =>
      (await import('./admin-panel/orders/page')).default({
        searchParams: Promise.resolve({}),
      }),
  ],
  [
    './admin-panel/orders/[id]/page.tsx',
    'order detail',
    async () =>
      (await import('./admin-panel/orders/[id]/page')).default({
        params: Promise.resolve({ id }),
      }),
  ],
  [
    './admin-panel/users/page.tsx',
    'users',
    async () =>
      (await import('./admin-panel/users/page')).default({
        searchParams: Promise.resolve({}),
      }),
  ],
  [
    './admin-panel/users/[id]/page.tsx',
    'user detail',
    async () =>
      (await import('./admin-panel/users/[id]/page')).default({
        // User ids are text, not uuids: a Better Auth-shaped one.
        params: Promise.resolve({ id: 'aB3dE5gH7jK9mN1pQ3sT5vX7zA9cD1f' }),
      }),
  ],
  [
    './admin-panel/insights/page.tsx',
    'insights',
    async () =>
      (await import('./admin-panel/insights/page')).default({
        searchParams: Promise.resolve({}),
      }),
  ],
  [
    './admin-panel/products/page.tsx',
    'products',
    async () =>
      (await import('./admin-panel/products/page')).default({
        searchParams: Promise.resolve({}),
      }),
  ],
  [
    './admin-panel/products/[id]/page.tsx',
    'product detail',
    async () =>
      (await import('./admin-panel/products/[id]/page')).default({
        params: Promise.resolve({ id }),
      }),
  ],
  [
    './admin-panel/products/new/page.tsx',
    'new product',
    async () => (await import('./admin-panel/products/new/page')).default(),
  ],
  [
    './admin-panel/products/categories/page.tsx',
    'categories',
    async () =>
      (await import('./admin-panel/products/categories/page')).default(),
  ],
  [
    './admin-panel/discounts/page.tsx',
    'discounts',
    async () => (await import('./admin-panel/discounts/page')).default(),
  ],
  [
    './admin-panel/shipping/page.tsx',
    'shipping',
    async () => (await import('./admin-panel/shipping/page')).default(),
  ],
  [
    './admin-panel/content/[area]/page.tsx',
    'content area',
    async () =>
      (await import('./admin-panel/content/[area]/page')).default({
        params: Promise.resolve({ area: 'home' }),
      }),
  ],
] as const;

describe('admin page authorization coverage', () => {
  it('includes every page that can read data', () => {
    // The content index is redirect-only and has no data access. Every other
    // page must be listed above, so adding a route without its auth test fails.
    const dataPages = Object.keys(pageModules)
      .filter((path) => path !== './admin-panel/content/page.tsx')
      .sort();
    expect(pages.map(([path]) => path).sort()).toEqual(dataPages);
  });
});

// Invoke each server page independently of its layout, as an independently
// rendered route segment can be. Exercise the real role gate; only session
// lookup and data access are mocked. A rejected visitor must never reach data.
describe.each(pages)(
  'admin %s (%s) page authorization',
  (_path, _name, render) => {
    beforeEach(() => vi.clearAllMocks());

    it.each([
      [
        null,
        `${PATHS.LOGIN}?next=${encodeURIComponent(PROTECTED_PATHS.INDEX)}`,
      ],
      [{ user: { role: 'customer' } }, PATHS.HOME],
      [{ user: { role: 'unknown' } }, PATHS.HOME],
    ])(
      'rejects unauthorized sessions before reading data (%j)',
      async (session, destination) => {
        mocks.getSession.mockResolvedValue(session);
        await expect(render()).rejects.toThrow(`REDIRECT:${destination}`);
        expect(mocks.read).not.toHaveBeenCalled();
      },
    );

    it('allows the admin to reach data access', async () => {
      mocks.getSession.mockResolvedValue({ user: { role: 'admin' } });
      await expect(render()).rejects.toThrow('AUTHORIZED_DATA_READ');
      expect(mocks.getSession).toHaveBeenCalled();
      expect(mocks.read).toHaveBeenCalled();
    });

    it('rechecks a revoked admin role on the next page render', async () => {
      mocks.getSession.mockResolvedValueOnce({ user: { role: 'admin' } });
      await expect(render()).rejects.toThrow('AUTHORIZED_DATA_READ');
      mocks.read.mockClear();
      mocks.getSession.mockResolvedValueOnce({ user: { role: 'customer' } });
      await expect(render()).rejects.toThrow(`REDIRECT:${PATHS.HOME}`);
      expect(mocks.read).not.toHaveBeenCalled();
    });
  },
);
