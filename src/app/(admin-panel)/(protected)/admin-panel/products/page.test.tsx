// Pins which row actions the admin product list offers. Deactivating is a soft
// delete, so an inactive product must not offer it again: clicking it there
// changed nothing, which read as a broken button. The page renders for real with
// its DAOs and the admin guard mocked at the module edge.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProductWithImages } from '@/db/schema/catalog';
import AdminProductsPage from './page';

const { listForAdmin } = vi.hoisted(() => ({ listForAdmin: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/db/dao/ProductDao', () => ({ ProductDao: { listForAdmin } }));
vi.mock('@/db/dao/CategoryDao', () => ({
  CategoryDao: { list: async () => [] },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(cleanup);

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

it('offers deactivation only on active products', async () => {
  listForAdmin.mockResolvedValue([
    product({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'محصول فعال',
      slug: 'active-product',
      sku: 'ACTIVE-1',
    }),
    product({
      id: '33333333-3333-4333-8333-333333333333',
      title: 'محصول غیرفعال',
      slug: 'inactive-product',
      sku: 'INACTIVE-1',
      isActive: false,
    }),
  ]);

  render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));

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
