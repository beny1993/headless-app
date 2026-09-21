import type { Metadata } from 'next';
import Link from 'next/link';
import { CategoryDao } from '@/db/dao/CategoryDao';
import { orderAsTree } from '@/lib/catalog/category-tree';
import { ProductDao } from '@/db/dao/ProductDao';
import { ProductCard } from '@/features/storefront/product/product-card';
import {
  ShopFilters,
  ShopFilterSheet,
} from '@/features/storefront/shop/shop-filters';
import { ShopPagination } from '@/features/storefront/shop/shop-pagination';
import { ShopResults } from '@/features/storefront/shop/shop-results';
import { ShopSearch } from '@/features/storefront/shop/shop-search';
import { ShopEmptyState } from '@/features/storefront/shop/shop-empty-state';
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

  const [{ items, total }, categories, priceBounds] = await Promise.all([
    ProductDao.list({
      categorySlug: query.category,
      petType: query.pet,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      search: query.q,
      sort: query.sort,
      page: query.page,
      limit: query.limit,
    }),
    CategoryDao.list(),
    // The slider's ends. Catalogue-wide on purpose: bounds that narrowed with
    // the current category would move the handles under the shopper's hand
    // every time they picked a shelf.
    ProductDao.priceBounds(),
  ]);

  // Narrowed to what the filter panel renders: `Category` also carries
  // timestamps, and the panel is a client component. Tree order, so each
  // sub-category arrives straight after its parent and the panel can nest it.
  const categoryOptions = orderAsTree(categories).map(
    ({ title, slug, depth }) => ({ title, slug, depth }),
  );

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
        <ShopSearch query={query} />

        <div className="mb-6 lg:hidden">
          <ShopFilterSheet
            query={query}
            categories={categoryOptions}
            priceBounds={priceBounds}
            total={total}
          />
        </div>

        <div className="flex gap-8">
          <aside className="hidden w-56 shrink-0 lg:block">
            <p className="mb-4 font-bold">فیلترها</p>
            <ShopFilters
              query={query}
              categories={categoryOptions}
              priceBounds={priceBounds}
            />
          </aside>

          <div className="min-w-0 flex-1">
            <ShopResults query={query} total={total} count={items.length}>
              {items.length === 0 ? (
                <ShopEmptyState
                  pastLastPage={pastLastPage}
                  searchTerm={query.q}
                  // Back to the first page *of this filter set* — sending a
                  // shopper who over-shot page 9 to the bare shop would throw
                  // away the filters they were browsing with.
                  firstPageHref={buildShopHref(
                    updateShopQuery(query, { page: 1 }),
                  )}
                  // Same reasoning for a search that missed: drop the term the
                  // shopper mistyped, keep the category and price they chose.
                  clearSearchHref={buildShopHref(
                    updateShopQuery(query, { q: undefined }),
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
