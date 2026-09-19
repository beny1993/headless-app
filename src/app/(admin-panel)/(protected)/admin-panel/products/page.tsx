import { requireAdmin } from '@/lib/auth/session';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Edit, Eye, Plus } from 'lucide-react';
import { z } from 'zod';
import { Pagination } from '@/components/ui/pagination';
import { CategoryDao } from '@/db/dao/CategoryDao';
import { categoryOptions } from '@/lib/catalog/category-tree';
import { ProductDao } from '@/db/dao/ProductDao';
import type { ProductWithImages } from '@/db/schema/catalog';
import { PET_TYPES } from '@/lib/catalog/product-query';
import { displayTitle } from '@/lib/catalog/variant';
import {
  adminEditProductPath,
  adminNewProductPath,
  productPath,
  PROTECTED_PATHS,
} from '@/lib/constant/paths';
import { formatToman, toPersianDigits } from '@/lib/format';
import { ADMIN_PAGE_SIZE, pageParamSchema } from '@/lib/pagination';
import { imageSrc } from '@/lib/storage/image-url';
import { DeleteProductButton } from '@/features/admin-panel/products/delete-product-button';

export const metadata: Metadata = { title: 'محصولات' };

// Reads the live catalog per request (and depends on searchParams).
export const dynamic = 'force-dynamic';

/** Active filter as it appears in the URL; mapped to the DAO's `active` below. */
const ACTIVE_VALUES = ['all', 'active', 'inactive'] as const;
type ActiveValue = (typeof ACTIVE_VALUES)[number];

// Page-level input degrades rather than 400s (the always-zod rule for pages): a
// bad value falls back to "no filter" via `.catch`, never throws.
const filterSchema = z.object({
  q: z.string().trim().min(1).optional().catch(undefined),
  category: z.string().trim().min(1).optional().catch(undefined),
  pet: z.enum([PET_TYPES.CAT, PET_TYPES.DOG]).optional().catch(undefined),
  active: z.enum(ACTIVE_VALUES).catch('all'),
  page: pageParamSchema,
});

/** The list's URL for one page, keeping the filters; page one has no `page`. */
const productsHref = (
  filters: z.infer<typeof filterSchema>,
  page: number,
): string => {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.category) params.set('category', filters.category);
  if (filters.pet) params.set('pet', filters.pet);
  if (filters.active !== 'all') params.set('active', filters.active);
  if (page > 1) params.set('page', String(page));
  const search = params.toString();
  return search
    ? `${PROTECTED_PATHS.PRODUCTS}?${search}`
    : PROTECTED_PATHS.PRODUCTS;
};

const activeToFilter = (value: ActiveValue): boolean | undefined =>
  value === 'all' ? undefined : value === 'active';

/** A stock cell that mirrors the design's availability badges. */
function StockBadge({ stock }: { stock: number }) {
  if (stock === 0) {
    return (
      <span className="bg-destructive-soft text-destructive rounded-full px-2.5 py-1 text-xs font-medium">
        ناموجود
      </span>
    );
  }
  const soft = stock <= 5;
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
        soft
          ? 'bg-warning-soft text-warning'
          : 'bg-success-soft text-success-strong'
      }`}
    >
      {soft ? 'رو به اتمام' : 'موجود'} ({toPersianDigits(stock)})
    </span>
  );
}

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const filters = filterSchema.parse(await searchParams);

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

      <div className="border-border overflow-hidden rounded-2xl border bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50">
              <tr>
                {[
                  'تصویر',
                  'نام محصول',
                  'برند',
                  'دسته',
                  'قیمت',
                  'موجودی',
                  'وضعیت',
                  'عملیات',
                ].map((heading) => (
                  <th
                    key={heading}
                    className="text-muted-foreground px-4 py-3 text-start font-semibold"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
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
            </tbody>
          </table>
        </div>
      </div>

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

function ProductRow({
  product,
  categoryTitle,
}: {
  product: ProductWithImages;
  categoryTitle: string;
}) {
  const imageKey = product.images[0]?.objectKey;
  return (
    <tr className="border-border hover:bg-secondary/20 border-t transition-colors">
      <td className="px-4 py-3">
        <div className="bg-muted relative h-10 w-10 overflow-hidden rounded-lg">
          {imageKey && (
            <Image
              src={imageSrc(imageKey)}
              alt=""
              fill
              sizes="40px"
              className="object-cover"
            />
          )}
        </div>
      </td>
      <td className="max-w-xs px-4 py-3 font-medium">
        {/* `displayTitle`, so the 10kg bag is findable and distinguishable
            from the 5kg one — the list shows every row, members included. */}
        <p className="line-clamp-2">{displayTitle(product)}</p>
      </td>
      <td className="text-muted-foreground px-4 py-3 text-xs">
        {product.brand ?? '—'}
      </td>
      <td className="px-4 py-3 text-xs">{categoryTitle}</td>
      <td className="px-4 py-3 text-xs font-semibold">
        {formatToman(product.price)}
      </td>
      <td className="px-4 py-3">
        <StockBadge stock={product.stock} />
      </td>
      <td className="px-4 py-3">
        {product.isActive ? (
          <span className="bg-success-soft text-success-strong rounded-full px-2.5 py-1 text-xs font-medium">
            فعال
          </span>
        ) : (
          <span className="bg-secondary text-muted-foreground rounded-full px-2.5 py-1 text-xs font-medium">
            غیرفعال
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <Link
            href={productPath(product.slug)}
            // `displayTitle` on every control in the row: the members of a
            // family share one `title`, so plain titles give three rows three
            // identically-named buttons — indistinguishable to a screen reader
            // and to anyone trying to edit the 10kg rather than the 5kg.
            aria-label={`مشاهده ${displayTitle(product)} در فروشگاه`}
            className="hover:bg-secondary flex h-10 w-10 items-center justify-center rounded-lg transition-colors"
          >
            <Eye size={14} aria-hidden="true" />
          </Link>
          <Link
            href={adminEditProductPath(product.id)}
            aria-label={`ویرایش ${displayTitle(product)}`}
            data-umami-event="admin-panel-products-edit"
            className="hover:bg-secondary flex h-10 w-10 items-center justify-center rounded-lg transition-colors"
          >
            <Edit size={14} aria-hidden="true" />
          </Link>
          {/* Deactivating is a soft delete: an inactive product has nothing left
              to deactivate, and reactivating is the edit form's checkbox. */}
          {product.isActive && (
            <DeleteProductButton
              id={product.id}
              title={displayTitle(product)}
            />
          )}
        </div>
      </td>
    </tr>
  );
}
