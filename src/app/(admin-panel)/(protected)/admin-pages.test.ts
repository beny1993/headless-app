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
  ProductDao: { listForAdmin: mocks.read, findByIdForAdmin: mocks.read },
}));
vi.mock('@/db/dao/OrderDao', () => ({
  OrderDao: { listForAdmin: mocks.read },
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
vi.mock('@/logic/orders/dashboard-report', () => ({
  buildDashboardReport: mocks.read,
}));
vi.mock('@/logic/orders/get-admin-order', () => ({
  getAdminOrder: mocks.read,
}));

const id = '00000000-0000-4000-8000-000000000001';
const pages = [
  ['dashboard', async () => (await import('./admin-panel/page')).default()],
  [
    'orders',
    async () =>
      (await import('./admin-panel/orders/page')).default({
        searchParams: Promise.resolve({}),
      }),
  ],
  [
    'order detail',
    async () =>
      (await import('./admin-panel/orders/[id]/page')).default({
        params: Promise.resolve({ id }),
      }),
  ],
  [
    'products',
    async () =>
      (await import('./admin-panel/products/page')).default({
        searchParams: Promise.resolve({}),
      }),
  ],
  [
    'product detail',
    async () =>
      (await import('./admin-panel/products/[id]/page')).default({
        params: Promise.resolve({ id }),
      }),
  ],
  [
    'new product',
    async () => (await import('./admin-panel/products/new/page')).default(),
  ],
  [
    'discounts',
    async () => (await import('./admin-panel/discounts/page')).default(),
  ],
  [
    'shipping',
    async () => (await import('./admin-panel/shipping/page')).default(),
  ],
  [
    'content area',
    async () =>
      (await import('./admin-panel/content/[area]/page')).default({
        params: Promise.resolve({ area: 'home' }),
      }),
  ],
] as const;

// Invoke each server page independently of its layout, as an independently
// rendered route segment can be. Exercise the real role gate; only session
// lookup and data access are mocked. A rejected visitor must never reach data.
describe.each(pages)('admin %s page authorization', (_name, render) => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [null, `${PATHS.LOGIN}?next=${encodeURIComponent(PROTECTED_PATHS.INDEX)}`],
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
});
