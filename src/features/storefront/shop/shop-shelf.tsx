import { ProductCard } from '@/features/storefront/product/product-card';
import { Skeleton } from '@/components/ui/skeleton';
import type { ProductDao } from '@/db/dao/ProductDao';
import { ShopEmptyState } from './shop-empty-state';
import { ShopPagination } from './shop-pagination';
import { buildShopHref, updateShopQuery, type ShopQuery } from './shop-query';
import { ShopResults } from './shop-results';

type Listing = Awaited<ReturnType<typeof ProductDao.list>>;

/**
 * The part of `/shop` that waits for the listing: the toolbar with its count,
 * the cards (or the empty state) and the pager. The page streams it in behind
 * `<Suspense>`, so the heading, search and filters are on screen while this
 * query runs (`Story - Storefront Caching and Streaming`).
 */
export async function ShopShelf({
  query,
  listing,
}: {
  query: ShopQuery;
  /** Started by the page; the same `cache()`d read `generateMetadata` awaits. */
  listing: Promise<Listing>;
}) {
  const { items, total } = await listing;

  const totalPages = Math.ceil(total / query.limit);
  // A page past the end is not the same as a filter set that matches nothing,
  // and the two need different ways out. Neither is clamped: the URL asked for
  // page 9, so page 9 is what gets answered — honestly.
  const pastLastPage = items.length === 0 && total > 0;

  return (
    <>
      <ShopResults query={query} total={total} count={items.length}>
        {items.length === 0 ? (
          <ShopEmptyState
            pastLastPage={pastLastPage}
            searchTerm={query.q}
            // Back to the first page *of this filter set* — sending a shopper
            // who over-shot page 9 to the bare shop would throw away the
            // filters they were browsing with.
            firstPageHref={buildShopHref(updateShopQuery(query, { page: 1 }))}
            // Same reasoning for a search that missed: drop the term the
            // shopper mistyped, keep the category and price they chose.
            clearSearchHref={buildShopHref(
              updateShopQuery(query, { q: undefined }),
            )}
          />
        ) : (
          items.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              // The first row at the widest grid (`xl:grid-cols-3`). One of
              // these is the shop's LCP element, and which one depends on the
              // viewport — so all three are eager and none is preloaded.
              eager={index < 3}
            />
          ))
        )}
      </ShopResults>

      <ShopPagination query={query} totalPages={totalPages} />
    </>
  );
}

/** Six card-shaped blocks in the grid's own columns, while the listing loads. */
export function ShopShelfSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="در حال بارگذاری محصولات"
      data-testid="shop-shelf-skeleton"
    >
      <div className="mb-6 flex items-center justify-between gap-3">
        <Skeleton className="h-10 w-24 rounded-xl" />
        <Skeleton className="h-10 w-44 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="bg-card overflow-hidden rounded-2xl">
            <Skeleton className="aspect-square rounded-none" />
            <div className="space-y-2 p-4">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
