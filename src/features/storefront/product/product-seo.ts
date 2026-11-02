// What a product page tells search engines: its description, its canonical and
// share cards, and its schema.org `Product`, the structured data Google can
// show a price, stock, shipping and returns from.
import type { Metadata } from 'next';
import type { Product, ProductImage } from '@/db/schema/catalog';
import { displayTitle } from '@/lib/catalog/variant';
import { productPath } from '@/lib/constant/paths';
import {
  absoluteUrl,
  purchaseSentence,
  rialForStructuredData,
  SITE_OPEN_GRAPH,
  SITE_TWITTER,
} from '@/lib/seo';
import { imageSrc } from '@/lib/storage/image-url';
import { isPurchasable } from './availability';
import { HANDLING_DAYS, RETURN_DAYS, TRANSIT_DAYS } from './shop-policy';

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

/**
 * `text`, or its longest run of whole words that fits with an ellipsis. A
 * space at the very limit counts: the words before it fill the room exactly.
 * One word too long for the room is cut inside, but never between the two
 * UTF-16 halves of an emoji, which would print as «�».
 */
function fit(text: string): string {
  if (text.length <= DESCRIPTION_MAX_LENGTH) return text;
  const space = text.slice(0, DESCRIPTION_MAX_LENGTH).lastIndexOf(' ');
  if (space > 0) return `${text.slice(0, space)}…`;
  const end = DESCRIPTION_MAX_LENGTH - 1;
  const high = text.charCodeAt(end - 1);
  const splitsPair = high >= 0xd800 && high <= 0xdbff;
  return `${text.slice(0, splitsPair ? end - 1 : end)}…`;
}

/** On one line: `\s` also takes NBSP, but not ZWNJ, which is not whitespace. */
const oneLine = (text: string | null) =>
  (text ?? '').replace(/\s+/g, ' ').trim();

/**
 * The meta description: the product's own description, else its benefit line,
 * else a sentence naming it. Both texts are read on one line, so the only cut
 * points are spaces and a ZWNJ compound («شمع‌ها») is never split.
 */
export function productDescription(product: ProductForSeo): string {
  const text = oneLine(product.description) || oneLine(product.benefit);
  return text ? fit(text) : purchaseSentence(displayTitle(product));
}

/** The page's own URL, which its canonical, share card and offer all name. */
const productUrl = (product: ProductForSeo) =>
  absoluteUrl(productPath(product.slug));

/** The absolute URL of a product photo, for crawlers that resolve nothing. */
const photoUrl = (image: Pick<ProductImage, 'objectKey'>) =>
  absoluteUrl(imageSrc(image.objectKey));

/**
 * The page's metadata. Both cards spread the site's back in, since Next
 * replaces a nested metadata object instead of merging it. The first photo is
 * the share image, on a large Twitter card; a product without one keeps the
 * site's image and small card.
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
    twitter: {
      ...SITE_TWITTER,
      title,
      description,
      ...(images && { card: 'summary_large_image', images }),
    },
  };
}

/** A span of days, as Google reads a handling or transit time. */
const dayRange = ({ min, max }: { min: number; max: number }) => ({
  '@type': 'QuantitativeValue',
  minValue: min,
  maxValue: max,
  unitCode: 'DAY',
});

/**
 * Shipping anywhere in Iran, in Rial like the price. Google takes regional
 * rates only for a few countries, Iran not among them, so fees that differ by
 * province go in as the most a shopper can pay (`maxValue`).
 */
function shippingDetails(fees: number[]) {
  const most = rialForStructuredData(Math.max(...fees));
  const flat = fees.every((fee) => fee === fees[0]);
  return {
    '@type': 'OfferShippingDetails',
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'IR' },
    shippingRate: {
      '@type': 'MonetaryAmount',
      currency: 'IRR',
      ...(flat ? { value: most } : { maxValue: most }),
    },
    deliveryTime: {
      '@type': 'ShippingDeliveryTime',
      handlingTime: dayRange(HANDLING_DAYS),
      transitTime: dayRange(TRANSIT_DAYS),
    },
  };
}

const RETURN_POLICY = {
  '@type': 'MerchantReturnPolicy',
  applicableCountry: 'IR',
  returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
  merchantReturnDays: RETURN_DAYS,
  returnMethod: 'https://schema.org/ReturnByMail',
  returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility',
};

/**
 * The page's schema.org `Product`. The price goes in Rial (see
 * `rialForStructuredData`), and stock through the add-to-cart button's own
 * `isPurchasable`, so low stock still reads as in stock. `shippingFees` are
 * the active provinces' fees in Toman; with none, shipping is left out. What
 * the product lacks is left out rather than sent as `null`.
 */
export function productJsonLd(product: ProductForSeo, shippingFees: number[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: displayTitle(product),
    ...(product.images.length > 0 && { image: product.images.map(photoUrl) }),
    description: productDescription(product),
    sku: product.sku,
    ...(product.brand && { brand: { '@type': 'Brand', name: product.brand } }),
    offers: {
      '@type': 'Offer',
      url: productUrl(product),
      priceCurrency: 'IRR',
      price: rialForStructuredData(product.price),
      availability: isPurchasable(product.stock)
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      ...(shippingFees.length > 0 && {
        shippingDetails: shippingDetails(shippingFees),
      }),
      hasMerchantReturnPolicy: RETURN_POLICY,
    },
  };
}
