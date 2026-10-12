import { cache, Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { orderAsTree } from '@/lib/catalog/category-tree';
import { ProductDao } from '@/db/dao/ProductDao';
import {
  ShopFilters,
  ShopFilterSheet,
} from '@/features/storefront/shop/shop-filters';
import { ShopSearch } from '@/features/storefront/shop/shop-search';
import {
  ShopShelf,
  ShopShelfSkeleton,
} from '@/features/storefront/shop/shop-shelf';
import {
  isUnknownCategory,
  SHOP_TITLE,
  shelfTitle,
  shopMetadata,
} from '@/features/storefront/shop/shop-metadata';
import {
  parseShopQuery,
  type ShopQuery,
} from '@/features/storefront/shop/shop-query';
import { PATHS } from '@/lib/constant/paths';
import {
  storefrontCategories,
  storefrontPriceBounds,
} from '@/logic/storefront/cached-reads';

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The categories: `generateMetadata` titles a shelf by its category, and the
 * page lists them in the filters. From the storefront cache an admin save drops
 * (`src/logic/storefront/cached-reads.ts`), which also shares one read between
 * the two.
 */
const listCategories = storefrontCategories;

type ListOptions = NonNullable<Parameters<typeof ProductDao.list>[0]>;

/**
 * This URL's page of the listing, read once per request: the page renders it,
 * and `generateMetadata` keeps a page that lists nothing out of the index.
 * Keyed by a string because `cache` compares arguments by identity, and every
 * parse of the query is a fresh object.
 */
const listShelf = cache((options: string) =>
  ProductDao.list(JSON.parse(options) as ListOptions),
);

const shelfListing = (query: ShopQuery) =>
  listShelf(
    JSON.stringify({
      categorySlug: query.category,
      petType: query.pet,
      inStock: query.inStock,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      search: query.q,
      sort: query.sort,
      page: query.page,
      limit: query.limit,
    } satisfies ListOptions),
  );

export async function generateMetadata({
  searchParams,
}: {
  searchParams: PageSearchParams;
}): Promise<Metadata> {
  const query = parseShopQuery(await searchParams);
  const [{ items }, categories] = await Promise.all([
    shelfListing(query),
    listCategories(),
  ]);
  // The page answers an unknown category with a 404, so, like the product page
  // for a missing product, there is no shop metadata to give it.
  if (isUnknownCategory(query, categories)) return {};
  return shopMetadata(query, categories, items.length > 0);
}

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
 * The listing reads through the DAO directly, live; the categories and the
 * price bounds come from the storefront cache. The listing
 * does not call its own HTTP API — that would be a network round trip to this
 * same process — but it does obey that API's contract, which is why
 * `shop-query.ts` borrows its types.
 */
export default async function ShopPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  const query = parseShopQuery(await searchParams);

  const [categories, priceBounds] = await Promise.all([
    listCategories(),
    // The slider's ends. Catalogue-wide on purpose: bounds that narrowed with
    // the current category would move the handles under the shopper's hand
    // every time they picked a shelf.
    storefrontPriceBounds(),
  ]);

  // A category that does not exist is a page that does not exist, like a
  // removed product: a real 404, so Google drops an old link to it. A known
  // category that lists nothing right now stays a page (noindexed by its
  // metadata), since it fills again when stock returns. Decided here, before
  // anything streams: once the first bytes are out the status is 200.
  if (isUnknownCategory(query, categories)) notFound();

  // `generateMetadata` awaits this same listing (its noindex decision). Next
  // streams metadata to browsers, so that does not hold the page up; only
  // HTML-limited bots get the shell after it, which is what they need.
  //
  // Started, not awaited: the listing is the one live read (it shows stock), so
  // everything above the results renders now and `ShopShelf` streams in behind
  // its skeleton when it lands. The filter sheet's count waits on the same read.
  const listing = shelfListing(query);

  // Narrowed to what the filter panel renders: `Category` also carries
  // timestamps, and the panel is a client component. Tree order, so each
  // sub-category arrives straight after its parent and the panel can nest it.
  const categoryOptions = orderAsTree(categories).map(
    ({ title, slug, depth }) => ({ title, slug, depth }),
  );

  // The heading names the shelf, as the tab title does: a shelf the sitemap
  // lists is a page of its own, and its visible title has to say so.
  const shelf = shelfTitle(query, categories);

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
            <span className="mx-1" aria-hidden="true">
              /
            </span>
            {shelf && (
              <>
                <Link
                  href={PATHS.SHOP}
                  className="hover:text-foreground"
                  data-umami-event="shop-breadcrumb-shop"
                >
                  {SHOP_TITLE}
                </Link>
                <span className="mx-1" aria-hidden="true">
                  /
                </span>
              </>
            )}
            <span className="text-foreground" aria-current="page">
              {shelf ?? SHOP_TITLE}
            </span>
          </nav>
          <h1 className="mb-2 text-4xl font-black">{shelf ?? SHOP_TITLE}</h1>
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
            total={listing.then(({ total }) => total)}
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
            <Suspense fallback={<ShopShelfSkeleton />}>
              <ShopShelf query={query} listing={listing} />
            </Suspense>
          </div>
        </div>
      </div>
    </main>
  );
}
