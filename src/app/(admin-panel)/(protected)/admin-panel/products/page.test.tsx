// Pins the admin product list: which row actions it offers, and how it pages.
// Deactivating is a soft delete, so an inactive product must not offer it again:
// clicking it there changed nothing, which read as a broken button. The page
// number lives in the URL next to the filters, and every page link keeps them.
// The page renders for real with its DAOs and the admin guard mocked at the
// module edge.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductWithImages } from '@/db/schema/catalog';
import { PROTECTED_PATHS } from '@/lib/constant/paths';
import { formatNumber } from '@/lib/format';
import { ADMIN_PAGE_SIZE } from '@/lib/pagination';
import AdminProductsPage from './page';

const { pageForAdmin } = vi.hoisted(() => ({ pageForAdmin: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/db/dao/ProductDao', () => ({ ProductDao: { pageForAdmin } }));
vi.mock('@/db/dao/CategoryDao', () => ({
  CategoryDao: { list: async () => [] },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const product = (
  overrides: Partial<ProductWithImages> &
    Pick<ProductWithImages, 'id' | 'title' | 'slug' | 'sku'>,
): ProductWithImages => ({
  brand: null,
  description: null,
  benefit: null,
  price: 100_000,
  oldPrice: null,
  stock: 5,
  isActive: true,
  categoryId: '22222222-2222-4222-8222-222222222222',
  petType: 'cat',
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  searchText: '',
  images: [],
  ...overrides,
});

const ACTIVE = product({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'محصول فعال',
  slug: 'active-product',
  sku: 'ACTIVE-1',
});

const renderPage = async (searchParams: Record<string, string>) =>
  render(
    await AdminProductsPage({ searchParams: Promise.resolve(searchParams) }),
  );

/** A link's target as a URL, so query order and encoding do not matter. */
const target = (name: string) =>
  new URL(
    screen.getByRole('link', { name }).getAttribute('href')!,
    'http://localhost',
  );

it('offers deactivation only on active products', async () => {
  pageForAdmin.mockResolvedValue({
    items: [
      ACTIVE,
      product({
        id: '33333333-3333-4333-8333-333333333333',
        title: 'محصول غیرفعال',
        slug: 'inactive-product',
        sku: 'INACTIVE-1',
        isActive: false,
      }),
    ],
    total: 2,
  });

  await renderPage({});

  expect(
    screen.getByRole('button', { name: 'غیرفعال کردن محصول فعال' }),
  ).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'غیرفعال کردن محصول غیرفعال' }),
  ).toBeNull();
  // Still listed and still editable: reactivating is the edit form's checkbox.
  expect(
    screen.getByRole('link', { name: 'ویرایش محصول غیرفعال' }),
  ).toBeTruthy();
});

describe('paging', () => {
  it('asks for the page in the URL and keeps the filters on every page link', async () => {
    pageForAdmin.mockResolvedValue({
      items: [ACTIVE],
      total: ADMIN_PAGE_SIZE * 2 + 5,
    });

    await renderPage({ q: 'غذا', pet: 'cat', active: 'inactive', page: '2' });

    expect(pageForAdmin).toHaveBeenCalledWith({
      search: 'غذا',
      categorySlug: undefined,
      petType: 'cat',
      active: false,
      page: 2,
      limit: ADMIN_PAGE_SIZE,
    });
    const next = target('صفحه بعد');
    expect(next.pathname).toBe(PROTECTED_PATHS.PRODUCTS);
    expect(Object.fromEntries(next.searchParams)).toEqual({
      q: 'غذا',
      pet: 'cat',
      active: 'inactive',
      page: '3',
    });
    // Page one is the plain filtered URL, with no `page` at all.
    expect(Object.fromEntries(target('صفحه قبل').searchParams)).toEqual({
      q: 'غذا',
      pet: 'cat',
      active: 'inactive',
    });
  });

  it('reads a malformed page as the first and shows no pager for one page', async () => {
    pageForAdmin.mockResolvedValue({ items: [ACTIVE], total: 1 });

    await renderPage({ page: 'abc' });

    expect(pageForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: ADMIN_PAGE_SIZE }),
    );
    expect(screen.queryByRole('link', { name: 'صفحه بعد' })).toBeNull();
  });

  it('says a page past the end is empty, and still links back', async () => {
    pageForAdmin.mockResolvedValue({ items: [], total: ADMIN_PAGE_SIZE + 1 });

    await renderPage({ page: '9' });

    expect(screen.getByText('این صفحه محصولی ندارد.')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: `صفحه ${formatNumber(1)}` }),
    ).toBeTruthy();
  });
});
