import Link from 'next/link';
import type { ProductWithImages } from '@/db/schema/catalog';
import { ProductCard } from '@/features/storefront/product/product-card';
import { shopPath } from '@/lib/constant/paths';

/**
 * «انتخاب‌های اسموکی» — the featured grid. Everything in it comes from the
 * database (see `featured.ts` for which four and why); nothing here is
 * hardcoded product data.
 *
 * An empty list is a real state, not an error: a catalog that has not been
 * seeded yet, or a shop where everything in the first page is out of stock.
 * It says so rather than rendering an empty grid.
 */
export function RecommendsSection({
  products,
}: {
  products: ProductWithImages[];
}) {
  return (
    <section className="bg-secondary/40 py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <div className="mb-14 text-center">
          <span className="text-accent-strong mb-3 inline-block text-sm font-medium">
            کیوریت شده با دقت
          </span>
          <h2 className="mb-3 text-4xl font-black">انتخاب‌های اسموکی</h2>
          <p className="text-muted-foreground mx-auto max-w-lg">
            محصولاتی که اسموکی شخصاً تجربه کرده و توصیه می‌کند
          </p>
        </div>

        {products.length === 0 ? (
          <div className="text-center">
            <p className="text-muted-foreground mb-6">
              فعلاً محصولی برای نمایش نداریم — به‌زودی موجود می‌شود.
            </p>
            <Link
              href={shopPath()}
              className="bg-accent-strong hover:bg-accent-hover inline-block rounded-xl px-6 py-3 font-bold text-white transition-colors"
              data-umami-event="home-recommends-empty-shop-click"
            >
              مشاهده فروشگاه
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
