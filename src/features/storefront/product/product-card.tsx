import Image from 'next/image';
import Link from 'next/link';
import { Check, ShoppingBag } from 'lucide-react';
import { AddToCartButton } from './add-to-cart-button';
import type { ProductCard as ProductCardRow } from '@/db/schema/catalog';
import { productPath } from '@/lib/constant/paths';
import { formatToman } from '@/lib/format';
import { imageSrc } from '@/lib/storage/image-url';

/**
 * One product tile, shared by the home page's recommendations and — when it
 * lands — the shop grid. A server component; only the add button is client.
 *
 * The card is clickable in full without being a clickable `<div>` and without
 * nesting a button inside an anchor (invalid HTML, and a screen reader reads
 * the two as one confusing control). The title link stretches an overlay
 * across the whole card instead, so there is exactly one tab stop for
 * navigation, named by the product title, and the add button sits above it.
 *
 * Two things the design shows are deliberately absent: the star rating
 * (reviews are backlog) and the wishlist heart (backlog) — both cut in the
 * design review's «Omitted in v1» list.
 *
 * The `group-data-[view=list]/results:` classes are the shop's list view, and
 * they are driven entirely by an ancestor (`data-view` on the shop's results
 * container). No prop, so no caller can regress: the home page has no such
 * ancestor and renders exactly as before. The group is *named* because this
 * card already uses an unnamed `group` for its own image hover.
 */
export function ProductCard({ product }: { product: ProductCardRow }) {
  // The **family's** stock, not this row's: a sold-out head must not grey out a
  // card whose other size is on the shelf.
  const outOfStock = !product.familyInStock;
  const imageKey = product.images[0]?.objectKey;
  // A family sends the shopper to the page to choose — adding the head straight
  // from the grid would pick a smell or a size nobody asked for. True even when
  // the prices agree, which is why it is its own fact and not `familyPricesVary`.
  const mustChoose = product.familyHasMembers;

  return (
    <article className="group bg-card relative overflow-hidden rounded-2xl transition-[transform,box-shadow] duration-300 group-data-[view=list]/results:flex group-data-[view=list]/results:items-stretch hover:-translate-y-1 hover:shadow-lg">
      <div className="bg-secondary relative aspect-square overflow-hidden group-data-[view=list]/results:aspect-auto group-data-[view=list]/results:w-32 group-data-[view=list]/results:shrink-0 sm:group-data-[view=list]/results:w-44">
        {imageKey ? (
          <Image
            // A storage key, not a URL: `imageSrc` resolves it — bundled
            // `products/…` from public/, an `uploads/…` object from the bucket.
            src={imageSrc(imageKey)}
            alt=""
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
            className={`object-cover transition-transform duration-500 group-hover:scale-105 ${
              outOfStock ? 'opacity-60 grayscale' : ''
            }`}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ShoppingBag
              size={32}
              className="text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        )}

        {outOfStock ? (
          <span className="bg-muted text-muted-foreground absolute end-3 top-3 rounded-full px-2 py-0.5 text-xs font-medium">
            ناموجود
          </span>
        ) : product.oldPrice && !product.familyPricesVary ? (
          <span className="bg-accent-strong absolute end-3 top-3 rounded-full px-2 py-0.5 text-xs font-medium text-white">
            تخفیف
          </span>
        ) : null}
      </div>

      <div className="p-4 group-data-[view=list]/results:flex group-data-[view=list]/results:min-w-0 group-data-[view=list]/results:flex-1 group-data-[view=list]/results:flex-col group-data-[view=list]/results:justify-center">
        {product.brand && (
          <p className="text-muted-foreground mb-1 text-xs">{product.brand}</p>
        )}
        <h3 className="text-foreground mb-2 line-clamp-2 text-sm leading-relaxed font-semibold">
          <Link
            href={productPath(product.slug)}
            // Stretches the link's hit area over the whole card without
            // wrapping the add button in an anchor.
            className="after:absolute after:inset-0"
            data-umami-event="product-card-open"
          >
            {product.title}
          </Link>
        </h3>
        {product.benefit && (
          <p className="text-success-strong mb-3 flex items-center gap-1 text-xs">
            <Check size={10} className="shrink-0" aria-hidden="true" />
            {product.benefit}
          </p>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="nums min-w-0">
            <p className="text-foreground font-bold">
              {product.familyPricesVary ? (
                // «از ۲۵۰٬۰۰۰ تومان» — the family's cheapest. The prefix is a
                // separate span so it keeps the body type size while the number
                // stays bold, and so `nums` still governs only the digits.
                <>
                  <span className="text-muted-foreground me-1 text-xs font-normal">
                    از
                  </span>
                  {/* A real space, not just the margin: without it the text
                      content reads «از۱۴۹٬۰۰۰» to a screen reader and to
                      anyone who copies the line. */}{' '}
                  {formatToman(product.familyMinPrice)}
                </>
              ) : (
                formatToman(product.price)
              )}
            </p>
            {/* A struck-through «was» price under an «از …» would be claiming a
                discount on a price the card is not even showing. */}
            {product.oldPrice && !product.familyPricesVary && (
              <p className="text-muted-foreground text-xs line-through">
                {formatToman(product.oldPrice)}
              </p>
            )}
          </div>
          {mustChoose ? (
            // A real link, not a disabled button: the shopper's next step is
            // the page, where the chips are. It sits above the stretched title
            // overlay so it reads as its own control to a screen reader, and
            // it names the product for the same reason.
            <Link
              href={productPath(product.slug)}
              className="bg-secondary text-foreground hover:bg-secondary/80 relative z-10 inline-flex min-h-11 shrink-0 items-center rounded-xl px-4 text-sm font-medium transition-colors"
              data-umami-event="product-card-choose"
            >
              انتخاب
              <span className="sr-only"> {product.title}</span>
            </Link>
          ) : (
            <AddToCartButton
              // Above the stretched title overlay, so the click adds to the cart
              // instead of navigating.
              className="relative z-10"
              outOfStock={outOfStock}
              line={{
                productId: product.id,
                slug: product.slug,
                title: product.title,
                sku: product.sku,
                brand: product.brand ?? undefined,
                unitPrice: product.price,
                imageKey,
              }}
            />
          )}
        </div>
      </div>
    </article>
  );
}
