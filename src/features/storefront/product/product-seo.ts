// What a product page tells search engines: its description, its canonical and
// share cards, and its schema.org `Product`, the structured data Google can
// show a price and stock from.
import type { Metadata } from 'next';
import { DEFAULT_SITE_NAME } from '@/constants';
import type { Product, ProductImage } from '@/db/schema/catalog';
import { displayTitle } from '@/lib/catalog/variant';
import { productPath } from '@/lib/constant/paths';
import {
  absoluteUrl,
  rialForStructuredData,
  SITE_OPEN_GRAPH,
  SITE_TWITTER,
} from '@/lib/seo';
import { imageSrc } from '@/lib/storage/image-url';
import { isPurchasable } from './availability';

/** The fields read here; a `ProductDetail` has them all. */
export type ProductForSeo = Pick<
  Product,
  | 'slug'
  | 'title'
  | 'variantLabel'
  | 'sku'
  | 'brand'
  | 'description'
  | 'benefit'
  | 'price'
  | 'stock'
> & { images: Pick<ProductImage, 'objectKey'>[] };

/** About what Google shows of a description before it cuts one itself. */
export const DESCRIPTION_MAX_LENGTH = 155;

/** `text`, or its longest run of whole words that fits with an ellipsis. */
function fit(text: string): string {
  if (text.length <= DESCRIPTION_MAX_LENGTH) return text;
  const room = text.slice(0, DESCRIPTION_MAX_LENGTH - 1);
  const space = room.lastIndexOf(' ');
  return `${space > 0 ? room.slice(0, space) : room}…`;
}

/**
 * The meta description: the product's own description on one line, else its
 * benefit line, else a sentence naming it. `\s` collapses the line breaks but
 * not ZWNJ, which is not whitespace, and the cut is only ever at a space, so a
 * ZWNJ compound («گربه‌ها») is never split.
 */
export function productDescription(product: ProductForSeo): string {
  const description = (product.description ?? '').replace(/\s+/g, ' ').trim();
  if (description) return fit(description);
  const benefit = product.benefit?.trim();
  if (benefit) return fit(benefit);
  return `خرید ${displayTitle(product)} از ${DEFAULT_SITE_NAME}، فروشگاه آنلاین حیوانات خانگی.`;
}

/** The page's own URL, which its canonical, share card and offer all name. */
const productUrl = (product: ProductForSeo) =>
  absoluteUrl(productPath(product.slug));

/** The absolute URL of a product photo, for crawlers that resolve nothing. */
const photoUrl = (image: Pick<ProductImage, 'objectKey'>) =>
  absoluteUrl(imageSrc(image.objectKey));

/**
 * The page's metadata. `openGraph` spreads the site card back in, since Next
 * replaces a nested metadata object instead of merging it. The first photo is
 * the share image; a product without one keeps the site's.
 */
export function productMetadata(product: ProductForSeo): Metadata {
  const title = displayTitle(product);
  const description = productDescription(product);
  const url = productUrl(product);
  const photo = product.images[0];
  const images = photo && [{ url: photoUrl(photo), alt: title }];

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      ...SITE_OPEN_GRAPH,
      url,
      title,
      description,
      ...(images && { images }),
    },
    twitter: images
      ? { card: 'summary_large_image', title, description, images }
      : { ...SITE_TWITTER, title, description },
  };
}

/**
 * The page's schema.org `Product`. The price goes in Rial (see
 * `rialForStructuredData`), and stock through the add-to-cart button's own
 * `isPurchasable`, so low stock still reads as in stock. What the product
 * lacks is left out rather than sent as `null`.
 */
export function productJsonLd(product: ProductForSeo, categoryTitle?: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: displayTitle(product),
    ...(product.images.length > 0 && { image: product.images.map(photoUrl) }),
    description: productDescription(product),
    sku: product.sku,
    ...(product.brand && { brand: { '@type': 'Brand', name: product.brand } }),
    ...(categoryTitle && { category: categoryTitle }),
    offers: {
      '@type': 'Offer',
      url: productUrl(product),
      priceCurrency: 'IRR',
      price: rialForStructuredData(product.price),
      availability: isPurchasable(product.stock)
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
    },
  };
}
