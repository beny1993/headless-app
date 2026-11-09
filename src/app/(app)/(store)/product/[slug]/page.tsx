import { cache, Fragment } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Check, Truck, Undo2 } from 'lucide-react';
import { JsonLd } from '@/components/json-ld';
import { ProductDao } from '@/db/dao/ProductDao';
import {
  AVAILABILITY,
  availability,
} from '@/features/storefront/product/availability';
import { ProductGallery } from '@/features/storefront/product/product-gallery';
import { ProductPurchase } from '@/features/storefront/product/product-purchase';
import {
  productJsonLd,
  productMetadata,
} from '@/features/storefront/product/product-seo';
import { ProductTabs } from '@/features/storefront/product/product-tabs';
import {
  DELIVERY_NOTE,
  RETURN_NOTE,
} from '@/features/storefront/product/shop-policy';
import { Spec } from '@/features/storefront/product/spec-row';
import { StockNotice } from '@/features/storefront/product/stock-notice';
import { VariantChips } from '@/features/storefront/product/variant-chips';
import { SHOP_TITLE } from '@/features/storefront/shop/shop-metadata';
import { productSlugSchema } from '@/lib/catalog/product-query';
import { displayTitle } from '@/lib/catalog/variant';
import type { ProductDetail } from '@/db/schema/catalog';
import { PATHS, productPath, shopPath } from '@/lib/constant/paths';
import { formatToman } from '@/lib/format';
import { breadcrumbJsonLd } from '@/lib/seo';
import {
  storefrontCategories,
  storefrontShippingRates,
} from '@/logic/storefront/cached-reads';

/**
 * The product detail page, ported from `design/src/app/App.tsx`.
 *
 * Rendered per request, as the home and shop pages are: a product's price and
 * stock would otherwise freeze into the build output, and `next build` — a
 * quality gate, and the Docker image build — has no database to reach.
 */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

/**
 * The slug is visitor input, so it crosses a zod schema before it reaches the
 * catalog — the shared one the API validates `GET /api/products/{slug}` with,
 * imported rather than restated (the always-zod rule: derive, never mirror).
 * Where the API answers 400 this answers `null`, which the caller turns into
 * the same 404 an unknown product gets: a page has no error envelope, and a
 * malformed slug and a missing product are the same fact to a visitor.
 *
 * `getBySlug` filters `is_active` itself, so a soft-deleted product arrives
 * here as `null` too — inactive stays indistinguishable from missing on this
 * side of the wire exactly as it is on the API's.
 *
 * Wrapped in React's `cache` because `generateMetadata` and the page component
 * both need the same product: Next memoizes `fetch` across the two for free,
 * but this reads through a DAO, and without the wrapper one page view runs the
 * product query and its images query twice on two connections (measured). The
 * cache is per-request, so it never serves one visitor's product to the next.
 */
const findProduct = cache(
  async (slug: string): Promise<ProductDetail | null> => {
    const parsed = productSlugSchema.safeParse(slug);
    return parsed.success ? ProductDao.getBySlug(parsed.data) : null;
  },
);

/**
 * No title at all when the product is missing, rather than a placeholder one:
 * this route is about to render the 404 page, and `not-found.tsx` sets «صفحه
 * پیدا نشد» itself. A fallback here would win over it and label a 404 as a
 * product page in the tab and in every link preview of it.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const product = await findProduct(slug);

  return product ? productMetadata(product) : {};
}

export default async function ProductDetailPage({ params }: Params) {
  const { slug } = await params;

  // Independent reads, in parallel. The product is live — its price and stock
  // must be exact — while the category list (for the breadcrumb) and the
  // province fees (shipping in the structured data) come from the storefront
  // cache an admin save drops (`src/logic/storefront/cached-reads.ts`).
  const [product, categories, rates] = await Promise.all([
    findProduct(slug),
    storefrontCategories(),
    storefrontShippingRates(),
  ]);
  if (!product) notFound();

  // A product cannot exist without its category (`category_id` is NOT NULL
  // behind a restricting foreign key), but the lookup is still optional-typed
  // — the crumb is dropped rather than the page failing over a link.
  const category = categories.find((row) => row.id === product.categoryId);
  // A sub-category's parent gets a crumb of its own, so the trail reads
  // «فروشگاه › بهداشت › شامپو و نظافت». Optional-typed for the same reason.
  const parentCategory = categories.find(
    (row) => row.id === category?.parentId,
  );
  // Every category the product is filed under, main first, then the additional
  // ones in the order the admin added them — the breadcrumb above still
  // follows the main one alone. A category that has since vanished is simply
  // dropped rather than failing the page over a link.
  const filedUnder = [product.categoryId, ...product.extraCategoryIds].flatMap(
    (id) => categories.filter((row) => row.id === id),
  );
  const state = availability(product.stock);

  // One trail for the nav and for its structured data, so the markup Google
  // reads can never name a crumb the page does not show. The last crumb is
  // this page, shown as text.
  const trail: { name: string; path: string; umamiEvent?: string }[] = [
    { name: 'خانه', path: PATHS.HOME },
    { name: SHOP_TITLE, path: PATHS.SHOP },
    ...(parentCategory
      ? [
          {
            name: parentCategory.title,
            path: shopPath({ category: parentCategory.slug }),
            umamiEvent: 'product-breadcrumb-parent-category',
          },
        ]
      : []),
    ...(category
      ? [
          {
            name: category.title,
            path: shopPath({ category: category.slug }),
            umamiEvent: 'product-breadcrumb-category',
          },
        ]
      : []),
    { name: displayTitle(product), path: productPath(product.slug) },
  ];

  return (
    <main className="min-h-screen">
      <JsonLd
        data={productJsonLd(
          product,
          rates.map((rate) => rate.fee),
        )}
      />
      <JsonLd data={breadcrumbJsonLd(trail)} />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
        <nav
          aria-label="مسیر صفحه"
          className="text-muted-foreground mb-8 flex flex-wrap items-center gap-2 text-sm"
        >
          {trail.map((crumb, index) => (
            <Fragment key={crumb.path}>
              {index > 0 && <span aria-hidden="true">/</span>}
              {index < trail.length - 1 ? (
                <Link
                  href={crumb.path}
                  className="hover:text-foreground"
                  data-umami-event={crumb.umamiEvent}
                >
                  {crumb.name}
                </Link>
              ) : (
                <span className="text-foreground" aria-current="page">
                  {crumb.name}
                </span>
              )}
            </Fragment>
          ))}
        </nav>

        <div className="mb-16 grid grid-cols-1 gap-12 lg:grid-cols-2">
          {/* Keyed: without it React keeps the gallery's tree position across a
              client-side move from one product page to another, and the photo
              the visitor had selected on the last product opens on this one. */}
          <ProductGallery
            key={product.id}
            images={product.images}
            title={displayTitle(product)}
          />

          <div className="flex flex-col">
            {product.brand && (
              <p className="text-muted-foreground mb-1 text-sm">
                {product.brand}
              </p>
            )}
            <h1 className="mb-3 text-3xl leading-tight font-black">
              {displayTitle(product)}
            </h1>
            {product.benefit && (
              <p className="text-success-strong mb-4 flex items-center gap-1.5 text-sm">
                <Check size={14} className="shrink-0" aria-hidden="true" />
                {product.benefit}
              </p>
            )}

            {/* Above the price, because picking a size changes it. */}
            <VariantChips variants={product.variants} label="نوع" />

            {/* No price on a sold-out page, as on the shop's cards; the
                structured data keeps it, since Google requires one per offer. */}
            {state !== AVAILABILITY.OUT_OF_STOCK && (
              <div className="nums mb-4 flex flex-wrap items-baseline gap-3">
                <span className="text-3xl font-black">
                  {formatToman(product.price)}
                </span>
                {product.oldPrice && (
                  <span className="text-muted-foreground text-lg line-through">
                    {formatToman(product.oldPrice)}
                  </span>
                )}
              </div>
            )}

            <div className="mb-6">
              <StockNotice state={state} stock={product.stock} />
            </div>

            <ProductPurchase
              stock={product.stock}
              line={{
                productId: product.id,
                slug: product.slug,
                // The same derivation the order snapshot uses, so the drawer,
                // the checkout summary and the invoice all name one thing.
                title: displayTitle(product),
                sku: product.sku,
                brand: product.brand ?? undefined,
                unitPrice: product.price,
                imageKey: product.images[0]?.objectKey,
              }}
            />

            {/* The terms the structured data repeats, so Google never shows
                one a shopper cannot read here. */}
            <ul className="text-muted-foreground mt-6 space-y-2 text-sm">
              <li className="flex items-center gap-1.5">
                <Truck size={14} className="shrink-0" aria-hidden="true" />
                {DELIVERY_NOTE}
              </li>
              <li className="flex items-center gap-1.5">
                <Undo2 size={14} className="shrink-0" aria-hidden="true" />
                {RETURN_NOTE}
              </li>
            </ul>
          </div>
        </div>

        <ProductTabs
          tabs={[
            {
              id: 'description',
              label: 'توضیحات',
              content: (
                <p className="text-muted-foreground max-w-3xl leading-relaxed">
                  {product.description ??
                    'توضیحاتی برای این محصول ثبت نشده است.'}
                </p>
              ),
            },
            {
              id: 'details',
              label: 'مشخصات',
              content: (
                <dl className="max-w-3xl">
                  {product.brand && <Spec label="برند" value={product.brand} />}
                  <Spec label="کد کالا" value={product.sku} />
                  {filedUnder.length > 0 && (
                    <Spec
                      label="دسته‌بندی"
                      value={filedUnder.map((row, index) => (
                        <span key={row.id} className="flex items-center">
                          <Link
                            href={shopPath({ category: row.slug })}
                            className="hover:text-accent-strong hover:underline"
                            data-umami-event="product-category-link"
                          >
                            {row.title}
                          </Link>
                          {/* The comma is content, so it is a real node —
                              hiding it from a screen reader leaves the links
                              announced as the separate items they are. It
                              trails its own link, inside the same gap-less
                              span: Persian punctuation hugs the word before
                              it, and the `<dd>`'s gap is what separates the
                              items. At a wrap it ends the line, which is
                              where a separator belongs. */}
                          {index < filedUnder.length - 1 && (
                            <span aria-hidden="true">،</span>
                          )}
                        </span>
                      ))}
                    />
                  )}
                </dl>
              ),
            },
          ]}
        />
      </div>
    </main>
  );
}
