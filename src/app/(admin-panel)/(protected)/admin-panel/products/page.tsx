import { requireAdmin } from '@/lib/auth/session';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Pagination } from '@/components/ui/pagination';
import { CategoryDao } from '@/db/dao/CategoryDao';
import { categoryOptions } from '@/lib/catalog/category-tree';
import { ProductDao } from '@/db/dao/ProductDao';
import { PET_TYPES } from '@/lib/catalog/product-query';
import { adminNewProductPath } from '@/lib/constant/paths';
import { ADMIN_PAGE_SIZE } from '@/lib/pagination';
import { AdminTable } from '@/features/admin-panel/shared/admin-table';
import { ProductRow } from '@/features/admin-panel/products/product-row';
import {
  activeToFilter,
  adminProductFilterSchema,
  productsHref,
} from '@/features/admin-panel/products/products-query';

export const metadata: Metadata = { title: 'محصولات' };

// Reads the live catalog per request (and depends on searchParams).
export const dynamic = 'force-dynamic';

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const filters = adminProductFilterSchema.parse(await searchParams);

  const [{ items, total }, categories] = await Promise.all([
    ProductDao.pageForAdmin({
      search: filters.q,
      categorySlug: filters.category,
      petType: filters.pet,
      active: activeToFilter(filters.active),
      page: filters.page,
      limit: ADMIN_PAGE_SIZE,
    }),
    CategoryDao.list(),
  ]);
  const totalPages = Math.ceil(total / ADMIN_PAGE_SIZE);

  const categoryTitle = new Map(categories.map((c) => [c.id, c.title]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">محصولات</h1>
        <Link
          href={adminNewProductPath()}
          data-umami-event="admin-panel-products-new"
          className="bg-accent-strong hover:bg-accent-hover inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-colors"
        >
          <Plus size={14} aria-hidden="true" /> افزودن محصول
        </Link>
      </div>

      {/* Native GET form — no client JS. Submitting reloads with the filters in
          the URL, which the server reads back above. */}
      <form
        method="get"
        className="border-border grid grid-cols-1 gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <div className="lg:col-span-2">
          <label htmlFor="filter-q" className="sr-only">
            جستجوی محصول
          </label>
          <input
            id="filter-q"
            name="q"
            type="search"
            defaultValue={filters.q ?? ''}
            placeholder="جستجو در نام، برند یا مزیت"
            className="border-border focus-visible:border-accent-strong h-11 w-full rounded-xl border bg-white px-4 text-sm outline-none"
          />
        </div>
        <div>
          <label htmlFor="filter-category" className="sr-only">
            دسته‌بندی
          </label>
          <select
            id="filter-category"
            name="category"
            defaultValue={filters.category ?? ''}
            className="border-border focus-visible:border-accent-strong h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none"
          >
            <option value="">همه دسته‌ها</option>
            {categoryOptions(categories).map((category) => (
              <option key={category.id} value={category.slug}>
                {category.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="filter-pet" className="sr-only">
            نوع حیوان
          </label>
          <select
            id="filter-pet"
            name="pet"
            defaultValue={filters.pet ?? ''}
            className="border-border focus-visible:border-accent-strong h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none"
          >
            <option value="">همه حیوانات</option>
            <option value={PET_TYPES.CAT}>🐱 گربه</option>
            <option value={PET_TYPES.DOG}>🐶 سگ</option>
          </select>
        </div>
        <div className="flex gap-2">
          <label htmlFor="filter-active" className="sr-only">
            وضعیت نمایش
          </label>
          <select
            id="filter-active"
            name="active"
            defaultValue={filters.active}
            className="border-border focus-visible:border-accent-strong h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none"
          >
            <option value="all">همه (شامل غیرفعال)</option>
            <option value="active">فقط فعال</option>
            <option value="inactive">فقط غیرفعال</option>
          </select>
          <button
            type="submit"
            data-umami-event="admin-panel-products-filter"
            className="bg-ink shrink-0 rounded-xl px-4 text-sm font-medium text-white transition-colors hover:opacity-90"
          >
            اعمال
          </button>
        </div>
      </form>

      <AdminTable
        headings={[
          'تصویر',
          'نام محصول',
          'برند',
          'دسته',
          'قیمت',
          'موجودی',
          'وضعیت',
          'عملیات',
        ]}
      >
        {items.length === 0 ? (
          <tr>
            <td
              colSpan={8}
              className="text-muted-foreground px-4 py-10 text-center"
            >
              {/* Past the last page is not the same as nothing matching:
                        the pager below still links back. */}
              {total > 0
                ? 'این صفحه محصولی ندارد.'
                : 'محصولی با این فیلترها پیدا نشد.'}
            </td>
          </tr>
        ) : (
          items.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              categoryTitle={categoryTitle.get(product.categoryId) ?? '—'}
            />
          ))
        )}
      </AdminTable>

      <Pagination
        page={filters.page}
        totalPages={totalPages}
        hrefFor={(page) => productsHref(filters, page)}
        label="صفحه‌بندی محصولات"
        event="admin-panel-products-pagination"
      />
    </div>
  );
}
