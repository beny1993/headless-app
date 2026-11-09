// Pins the admin product list: which row actions it offers, how it pages, and
// how it counts. The 🗑 shows on every active product, and on an inactive one
// only when it can really be deleted: one with orders or members has nothing
// left to deactivate, so offering it there changed nothing and read as a
// broken button. The page number lives in the URL next to the filters, and
// every page link keeps them. The page renders for real with its DAOs, the
// hard-delete blocker read and the admin guard mocked at the module edge, so
// it touches no database.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductWithImages } from '@/db/schema/catalog';
import { SUBCATEGORY_PREFIX } from '@/lib/catalog/category-tree';
import { HARD_DELETE_BLOCKERS } from '@/lib/catalog/product-delete';
import { PROTECTED_PATHS } from '@/lib/constant/paths';
import { formatNumber } from '@/lib/format';
import { ADMIN_PAGE_SIZE } from '@/lib/pagination';
import AdminProductsPage from './page';

const { pageForAdmin, categories, hardDeleteBlockers } = vi.hoisted(() => ({
  pageForAdmin: vi.fn(),
  categories: vi.fn(),
  hardDeleteBlockers: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/db/dao/ProductDao', () => ({ ProductDao: { pageForAdmin } }));
vi.mock('@/db/dao/CategoryDao', () => ({ CategoryDao: { list: categories } }));
vi.mock('@/logic/admin/product-removal', () => ({ hardDeleteBlockers }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  categories.mockResolvedValue([]);
  hardDeleteBlockers.mockResolvedValue(new Map());
});

/** A category row as the page reads it; `parent` names its parent's slug. */
const category = (slug: string, title: string, parent?: string) => ({
  id: `id-${slug}`,
  title,
  slug,
  sortOrder: 0,
  parentId: parent ? `id-${parent}` : null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
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
  variantOf: null,
  variantLabel: null,
  categoryId: '22222222-2222-4222-8222-222222222222',
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  searchText: '',
  images: [],
  extraCategoryIds: [],
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

describe('the 🗑 (AC-6)', () => {
  const row = (id: string, title: string, isActive: boolean) =>
    product({ id, title, slug: `slug-${id}`, sku: `SKU-${id}`, isActive });
  const activeOrdered = row(
    '55555555-5555-4555-8555-555555555555',
    'فعال سفارش‌داده',
    true,
  );
  const inactiveFree = row(
    '66666666-6666-4666-8666-666666666666',
    'غیرفعال بی‌سفارش',
    false,
  );
  const inactiveOrdered = row(
    '77777777-7777-4777-8777-777777777777',
    'غیرفعال سفارش‌داده',
    false,
  );
  const inactiveHead = row(
    '88888888-8888-4888-8888-888888888888',
    'غیرفعال سرگروه',
    false,
  );

  beforeEach(() => {
    pageForAdmin.mockResolvedValue({
      items: [
        ACTIVE,
        activeOrdered,
        inactiveFree,
        inactiveOrdered,
        inactiveHead,
      ],
      total: 5,
    });
    hardDeleteBlockers.mockResolvedValue(
      new Map([
        [activeOrdered.id, HARD_DELETE_BLOCKERS.ORDERS],
        [inactiveOrdered.id, HARD_DELETE_BLOCKERS.ORDERS],
        [inactiveHead.id, HARD_DELETE_BLOCKERS.MEMBERS],
      ]),
    );
  });

  const trash = (title: string) =>
    screen.queryByRole('button', { name: `حذف ${title}` });

  it('reads the blockers once, for the whole page', async () => {
    await renderPage({});

    expect(hardDeleteBlockers).toHaveBeenCalledTimes(1);
    expect(hardDeleteBlockers).toHaveBeenCalledWith([
      ACTIVE.id,
      activeOrdered.id,
      inactiveFree.id,
      inactiveOrdered.id,
      inactiveHead.id,
    ]);
  });

  it('is always on an active product, ordered or not', async () => {
    await renderPage({});

    expect(trash(ACTIVE.title)).not.toBeNull();
    expect(trash(activeOrdered.title)).not.toBeNull();
  });

  it('is on an inactive product nothing references, so an old mistake can go', async () => {
    await renderPage({});

    expect(trash(inactiveFree.title)).not.toBeNull();
  });

  it('is not on an inactive product with orders or members', async () => {
    await renderPage({});

    expect(trash(inactiveOrdered.title)).toBeNull();
    expect(trash(inactiveHead.title)).toBeNull();
    // Still listed and still editable: reactivating is the edit form's checkbox.
    expect(
      screen.getByRole('link', { name: `ویرایش ${inactiveOrdered.title}` }),
    ).toBeTruthy();
  });
});

it('offers sub-categories under their parent, prefixed, in the filter', async () => {
  categories.mockResolvedValue([
    category('hygiene', 'بهداشت'),
    category('toys', 'اسباب‌بازی'),
    category('grooming', 'شامپو و نظافت', 'hygiene'),
  ]);
  pageForAdmin.mockResolvedValue({ items: [ACTIVE], total: 1 });

  await renderPage({});

  expect(
    [...(screen.getByLabelText('دسته‌بندی') as HTMLSelectElement).options].map(
      (option) => option.textContent,
    ),
  ).toEqual([
    'همه دسته‌ها',
    'بهداشت',
    `${SUBCATEGORY_PREFIX}شامپو و نظافت`,
    'اسباب‌بازی',
  ]);
});

describe('paging', () => {
  it('asks for the page in the URL and keeps the filters on every page link', async () => {
    pageForAdmin.mockResolvedValue({
      items: [ACTIVE],
      total: ADMIN_PAGE_SIZE * 2 + 5,
    });

    await renderPage({
      q: 'غذا',
      category: 'kitchen',
      active: 'inactive',
      page: '2',
    });

    expect(pageForAdmin).toHaveBeenCalledWith({
      search: 'غذا',
      categorySlug: 'kitchen',
      active: false,
      page: 2,
      limit: ADMIN_PAGE_SIZE,
    });
    const next = target('صفحه بعد');
    expect(next.pathname).toBe(PROTECTED_PATHS.PRODUCTS);
    expect(Object.fromEntries(next.searchParams)).toEqual({
      q: 'غذا',
      category: 'kitchen',
      active: 'inactive',
      page: '3',
    });
    // Page one is the plain filtered URL, with no `page` at all.
    expect(Object.fromEntries(target('صفحه قبل').searchParams)).toEqual({
      q: 'غذا',
      category: 'kitchen',
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

  it('numbers rows on from the pages before', async () => {
    pageForAdmin.mockResolvedValue({
      items: [
        ACTIVE,
        product({
          id: '44444444-4444-4444-8444-444444444444',
          title: 'محصول دوم',
          slug: 'second-product',
          sku: 'SECOND-1',
        }),
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

  it('counts the whole filtered result, not the page', async () => {
    pageForAdmin.mockResolvedValue({
      items: [ACTIVE],
      total: ADMIN_PAGE_SIZE * 2 + 5,
    });

    await renderPage({ q: 'غذا' });

    expect(
      screen.getByText(`${formatNumber(ADMIN_PAGE_SIZE * 2 + 5)} محصول`),
    ).toBeTruthy();
  });

  it('says a page past the end is empty, and still links back', async () => {
    // Fewer matches than one page, so page 2 is already past the end.
    pageForAdmin.mockResolvedValue({ items: [], total: 3 });

    await renderPage({ page: '2' });

    expect(screen.getByText('این صفحه محصولی ندارد.')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: `صفحه ${formatNumber(1)}` }),
    ).toBeTruthy();
  });
});
