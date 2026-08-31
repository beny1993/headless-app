import type { Metadata } from 'next';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { CategoryDao } from '@/db/dao/CategoryDao';
import { ProductDao } from '@/db/dao/ProductDao';
import { ProductCard } from '@/features/storefront/product/product-card';
import {
  ShopFilters,
  ShopFilterSheet,
} from '@/features/storefront/shop/shop-filters';
import { ShopPagination } from '@/features/storefront/shop/shop-pagination';
import { ShopResults } from '@/features/storefront/shop/shop-results';
import {
  buildShopHref,
  parseShopQuery,
  updateShopQuery,
} from '@/features/storefront/shop/shop-query';
import { PATHS } from '@/lib/constant/paths';

export const metadata: Metadata = { title: 'فروشگاه' };

/**
 * Rendered per request, for the same two reasons the home page is: the catalog
 * would otherwise freeze into the build output, and `next build` (a quality
 * gate, and the Docker image build) has no database to reach.
 *
 * `searchParams` makes this dynamic anyway; the export says so out loud rather
 * than leaving it to be inferred.
 */
export const dynamic = 'force-dynamic';

/**
 * The shop listing, ported from `design/src/app/App.tsx`.
 *
 * The URL is the whole state: filters, sort and page are read from
 * `searchParams` by `shop-query.ts` and fed straight into the DAO with the
 * catalog API's own validation semantics. An invalid parameter is dropped as
 * if it had not been sent — `/shop?sort=cheapest&page=-4` renders the default
 * listing rather than a 500 or a redirect, and the next click writes the clean
 * URL back.
 *
 * Reads go through the DAOs directly, as on the home page: two independent
 * single-DAO reads, so they belong here and not in `src/logic/`. The listing
 * does not call its own HTTP API — that would be a network round trip to this
 * same process — but it does obey that API's contract, which is why
 * `shop-query.ts` borrows its types.
 */
export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseShopQuery(await searchParams);

  const [{ items, total }, categories] = await Promise.all([
    ProductDao.list({
      categorySlug: query.category,
      petType: query.pet,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      sort: query.sort,
      page: query.page,
      limit: query.limit,
    }),
    CategoryDao.list(),
  ]);

  // Narrowed to what the filter panel renders: `Category` also carries
  // timestamps, and the panel is a client component.
  const categoryOptions = categories.map(({ title, slug }) => ({
    title,
    slug,
  }));

  const totalPages = Math.ceil(total / query.limit);
  // A page past the end is not the same as a filter set that matches nothing,
  // and the two need different ways out. Neither is clamped: the URL asked for
  // page 9, so page 9 is what gets answered — honestly.
  const pastLastPage = items.length === 0 && total > 0;

  return (
    <main className="min-h-screen">
      <div className="bg-secondary/30 px-4 py-10 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <nav
            aria-label="مسیر صفحه"
            className="text-muted-foreground mb-2 text-sm"
          >
            <Link href={PATHS.HOME} className="hover:text-foreground">
              خانه
            </Link>
            <span className="mx-1">/</span>
            <span className="text-foreground" aria-current="page">
              فروشگاه
            </span>
          </nav>
          <h1 className="mb-2 text-4xl font-black">فروشگاه</h1>
          <p className="text-muted-foreground">
            بهترین محصولات برای حیوان خانگی شما
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
        <SearchBox />

        <div className="mb-6 lg:hidden">
          <ShopFilterSheet
            query={query}
            categories={categoryOptions}
            total={total}
          />
        </div>

        <div className="flex gap-8">
          <aside className="hidden w-56 shrink-0 lg:block">
            <p className="mb-4 font-bold">فیلترها</p>
            <ShopFilters query={query} categories={categoryOptions} />
          </aside>

          <div className="min-w-0 flex-1">
            <ShopResults query={query} total={total} count={items.length}>
              {items.length === 0 ? (
                <EmptyState
                  pastLastPage={pastLastPage}
                  // Back to the first page *of this filter set* — sending a
                  // shopper who over-shot page 9 to the bare shop would throw
                  // away the filters they were browsing with.
                  firstPageHref={buildShopHref(
                    updateShopQuery(query, { page: 1 }),
                  )}
                />
              ) : (
                items.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))
              )}
            </ShopResults>

            <ShopPagination query={query} totalPages={totalPages} />
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * Rendered, and deliberately inert until [[Story - Persian Product Search]]
 * wires it — that story owns the normalization and the `pg_trgm` index behind
 * it. Disabled rather than hidden because the story asks for it on the page,
 * and the hint says why so it does not read as a bug.
 */
function SearchBox() {
  return (
    <div className="mb-5 max-w-xl">
      <label htmlFor="shop-search" className="sr-only">
        جستجو در محصولات
      </label>
      <div className="relative">
        <Search
          size={16}
          className="text-muted-foreground pointer-events-none absolute start-4 top-1/2 -translate-y-1/2"
          aria-hidden="true"
        />
        <input
          id="shop-search"
          type="search"
          disabled
          placeholder="جستجو بین محصولات…"
          aria-describedby="shop-search-hint"
          className="bg-secondary border-border w-full rounded-xl border py-3 ps-11 pe-4 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>
      <p id="shop-search-hint" className="text-muted-foreground mt-1.5 text-xs">
        جستجو به‌زودی فعال می‌شود — فعلاً از فیلترها استفاده کنید.
      </p>
    </div>
  );
}

/**
 * Two different nothings. A filter set that matches no product is the design's
 * empty state, and its way out is clearing the filters. A page number past the
 * end of the catalog is a URL problem, and its way out is page one — the
 * pagination is still on screen below, so this is a shortcut, not the only
 * exit.
 */
function EmptyState({
  pastLastPage,
  firstPageHref,
}: {
  pastLastPage: boolean;
  firstPageHref: string;
}) {
  return (
    <div className="bg-secondary/30 flex flex-col items-center justify-center gap-3 rounded-3xl py-24 text-center">
      <span className="text-5xl" aria-hidden="true">
        🔍
      </span>
      <p className="text-lg font-bold">
        {pastLastPage
          ? 'این صفحه محصولی ندارد'
          : 'محصولی با این فیلترها پیدا نشد'}
      </p>
      <p className="text-muted-foreground max-w-sm text-sm">
        {pastLastPage
          ? 'شماره صفحه از آخرین صفحه بیشتر است.'
          : 'می‌توانی فیلترها را کم کنی و دوباره امتحان کنی.'}
      </p>
      <Link
        href={pastLastPage ? firstPageHref : PATHS.SHOP}
        className="bg-accent-strong hover:bg-accent-hover mt-2 rounded-xl px-6 py-3 font-bold text-white transition-colors"
        data-umami-event={
          pastLastPage ? 'shop-empty-first-page' : 'shop-empty-clear-filters'
        }
      >
        {pastLastPage ? 'بازگشت به صفحه اول' : 'پاک کردن همه فیلترها'}
      </Link>
    </div>
  );
}
