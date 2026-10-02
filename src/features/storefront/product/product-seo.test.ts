import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SITE_ORIGIN } from '@/constants';
import { PET_TYPES } from '@/lib/catalog/product-query';
import { productPath } from '@/lib/constant/paths';
import {
  absoluteUrl,
  purchaseSentence,
  rialForStructuredData,
  SITE_OPEN_GRAPH,
} from '@/lib/seo';
import { imageSrc } from '@/lib/storage/image-url';
import {
  DESCRIPTION_MAX_LENGTH,
  productDescription,
  productJsonLd,
  productMetadata,
  type ProductForSeo,
} from './product-seo';
import { HANDLING_DAYS, RETURN_DAYS, TRANSIT_DAYS } from './shop-policy';

// A site-wide Twitter field for the product card to carry: Next replaces a
// nested metadata object, so a card built from scratch would drop it on
// exactly the products with a photo. `site` stands in for any field the site
// card gains later.
vi.mock('@/lib/seo', async (importOriginal) => {
  const seo = await importOriginal<typeof import('@/lib/seo')>();
  return {
    ...seo,
    SITE_TWITTER: { ...seo.SITE_TWITTER, site: '@smokeypetshop' },
  };
});

/** Constructed, never typed — the repo's control-character rule. */
const ZWNJ = String.fromCharCode(0x200c);
const NBSP = String.fromCharCode(0xa0);
/** One emoji: two UTF-16 units, which a cut must not separate. */
const CAT = String.fromCodePoint(0x1f431);

const product = (overrides: Partial<ProductForSeo> = {}): ProductForSeo => ({
  slug: 'royal-canin-adult-cat-dry-food',
  title: 'غذای خشک گربه بالغ',
  variantLabel: null,
  sku: 'RC-CAT-ADULT-2KG',
  brand: 'رویال کنین',
  petTypes: [PET_TYPES.CAT],
  description: null,
  benefit: 'مناسب گوارش حساس',
  price: 285_000,
  stock: 12,
  images: [
    { objectKey: 'products/cat-dry-food.jpg' },
    { objectKey: 'products/cat-toy.jpg' },
  ],
  ...overrides,
});

describe('productDescription', () => {
  it('reads the description first, on one line', () => {
    expect(
      productDescription(
        product({ description: `  غذای کامل\n\nبرای   گربه${ZWNJ}های بالغ  ` }),
      ),
    ).toBe(`غذای کامل برای گربه${ZWNJ}های بالغ`);
  });

  it('cuts a long description at a space, never inside a word', () => {
    const words = Array.from({ length: 60 }, (_, i) => `گربه${ZWNJ}های${i}`);
    const text = words.join(' ');
    const description = productDescription(product({ description: text }));
    const kept = description.slice(0, -1);

    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);
    expect(description.endsWith('…')).toBe(true);
    // A whole number of words: the kept text is the start of the original,
    // and the original breaks at a space right after it.
    expect(text.startsWith(kept)).toBe(true);
    expect(text[kept.length]).toBe(' ');
  });

  it('keeps every whole word that fits, up to a space at the very limit', () => {
    // A space at index 154: the first 154 characters are whole words, and
    // with the ellipsis they fill the limit exactly.
    const fits = `${'ب'.repeat(100)} ${'پ'.repeat(53)}`;
    const description = productDescription(
      product({ description: `${fits} ${'ت'.repeat(20)}` }),
    );

    expect(description).toBe(`${fits}…`);
    expect(description).toHaveLength(DESCRIPTION_MAX_LENGTH);
  });

  it('never splits an emoji in two when it has to cut inside a word', () => {
    // 'a' and 76 emoji are 153 units; a cut at 154 would keep half of the next.
    const description = productDescription(
      product({ description: `a${CAT.repeat(100)}` }),
    );

    expect(description).toBe(`a${CAT.repeat(76)}…`);
  });

  it('hard-cuts one word too long for the limit', () => {
    const description = productDescription(
      product({ description: 'ب'.repeat(400) }),
    );
    expect(description).toBe(`${'ب'.repeat(DESCRIPTION_MAX_LENGTH - 1)}…`);
  });

  it('keeps a description that fits whole', () => {
    const exact = 'پ'.repeat(DESCRIPTION_MAX_LENGTH);
    expect(productDescription(product({ description: exact }))).toBe(exact);
  });

  it('falls back to the benefit line, then to a sentence of its own', () => {
    expect(productDescription(product({ description: '  \n ' }))).toBe(
      'مناسب گوارش حساس',
    );

    const generated = productDescription(
      product({ description: null, benefit: null, variantLabel: '۲ کیلوگرم' }),
    );
    expect(generated).toBe(purchaseSentence('غذای خشک گربه بالغ — ۲ کیلوگرم'));
  });

  it('reads the benefit on one line too, so no-break spaces still cut at a word', () => {
    const words = Array.from({ length: 40 }, (_, i) => `واژه${i}`);

    expect(
      productDescription(product({ benefit: `مناسب${NBSP}گوارش${NBSP}حساس` })),
    ).toBe('مناسب گوارش حساس');
    // A long benefit joined by no-break spaces reads exactly as the same
    // words would as a description.
    expect(productDescription(product({ benefit: words.join(NBSP) }))).toBe(
      productDescription(product({ description: words.join(' ') })),
    );
  });
});

describe('productMetadata', () => {
  const canonical = `${DEFAULT_SITE_ORIGIN}/product/royal-canin-adult-cat-dry-food`;
  const firstPhoto = absoluteUrl(imageSrc('products/cat-dry-food.jpg'));

  it('names the product, describes it and points at its own URL', () => {
    const metadata = productMetadata(product({ variantLabel: 'لاوندر' }));

    expect(metadata.title).toBe('غذای خشک گربه بالغ — لاوندر');
    expect(metadata.description).toBe('مناسب گوارش حساس');
    expect(metadata.alternates?.canonical).toBe(canonical);
    expect(canonical).toBe(
      absoluteUrl(productPath('royal-canin-adult-cat-dry-food')),
    );
  });

  it('shares the first photo, and keeps the site-wide card fields a page would otherwise drop', () => {
    const metadata = productMetadata(product());

    expect(metadata.openGraph).toMatchObject({
      siteName: SITE_OPEN_GRAPH.siteName,
      locale: SITE_OPEN_GRAPH.locale,
      url: canonical,
      title: 'غذای خشک گربه بالغ',
      images: [{ url: firstPhoto }],
    });
    expect(metadata.twitter).toMatchObject({
      card: 'summary_large_image',
      images: [{ url: firstPhoto }],
    });
  });

  it('keeps the site-wide Twitter fields on the large card too', () => {
    expect(productMetadata(product()).twitter).toMatchObject({
      card: 'summary_large_image',
      site: '@smokeypetshop',
    });
  });

  it('falls back to the site image when the product has no photo', () => {
    const metadata = productMetadata(product({ images: [] }));

    expect(metadata.openGraph).toMatchObject({
      images: SITE_OPEN_GRAPH.images,
    });
    expect(metadata.twitter).toMatchObject({ card: 'summary' });
  });
});

describe('productJsonLd', () => {
  /** What every province pays today: one flat fee, in Toman. */
  const FLAT_FEES = [45_000, 45_000, 45_000];

  it('describes the product as Google reads it, priced in Rial', () => {
    expect(productJsonLd(product(), FLAT_FEES)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'غذای خشک گربه بالغ',
      image: [
        absoluteUrl(imageSrc('products/cat-dry-food.jpg')),
        absoluteUrl(imageSrc('products/cat-toy.jpg')),
      ],
      description: 'مناسب گوارش حساس',
      sku: 'RC-CAT-ADULT-2KG',
      brand: { '@type': 'Brand', name: 'رویال کنین' },
      category: {
        '@type': 'CategoryCode',
        inCodeSet:
          'https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt',
        codeValue: '4',
      },
      offers: {
        '@type': 'Offer',
        url: `${DEFAULT_SITE_ORIGIN}/product/royal-canin-adult-cat-dry-food`,
        priceCurrency: 'IRR',
        price: rialForStructuredData(285_000),
        availability: 'https://schema.org/InStock',
        itemCondition: 'https://schema.org/NewCondition',
        shippingDetails: {
          '@type': 'OfferShippingDetails',
          shippingDestination: {
            '@type': 'DefinedRegion',
            addressCountry: 'IR',
          },
          shippingRate: {
            '@type': 'MonetaryAmount',
            currency: 'IRR',
            value: rialForStructuredData(45_000),
          },
          deliveryTime: {
            '@type': 'ShippingDeliveryTime',
            handlingTime: {
              '@type': 'QuantitativeValue',
              minValue: HANDLING_DAYS.min,
              maxValue: HANDLING_DAYS.max,
              unitCode: 'DAY',
            },
            transitTime: {
              '@type': 'QuantitativeValue',
              minValue: TRANSIT_DAYS.min,
              maxValue: TRANSIT_DAYS.max,
              unitCode: 'DAY',
            },
          },
        },
        hasMerchantReturnPolicy: {
          '@type': 'MerchantReturnPolicy',
          applicableCountry: 'IR',
          returnPolicyCategory:
            'https://schema.org/MerchantReturnFiniteReturnWindow',
          merchantReturnDays: RETURN_DAYS,
          returnMethod: 'https://schema.org/ReturnByMail',
          returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility',
        },
      },
    });
  });

  it('files the product under Google’s pet supplies by the pets it is for', () => {
    const code = (petTypes: ProductForSeo['petTypes']) =>
      productJsonLd(product({ petTypes }), FLAT_FEES).category.codeValue;

    expect(code([PET_TYPES.CAT])).toBe('4');
    expect(code([PET_TYPES.DOG])).toBe('5');
    // Both pets: the branch the two share, never one of them.
    expect(code([PET_TYPES.CAT, PET_TYPES.DOG])).toBe('2');
  });

  it('prices shipping at the most a province pays when the fees differ', () => {
    const rate = productJsonLd(product(), [30_000, 80_000, 55_000]).offers
      .shippingDetails?.shippingRate;

    expect(rate).toEqual({
      '@type': 'MonetaryAmount',
      currency: 'IRR',
      maxValue: rialForStructuredData(80_000),
    });
  });

  it('reads free shipping everywhere as a rate of zero', () => {
    expect(
      productJsonLd(product(), [0, 0]).offers.shippingDetails?.shippingRate,
    ).toMatchObject({ value: 0 });
  });

  it('leaves shipping out when no province is priced, and keeps the return policy', () => {
    const { offers } = productJsonLd(product(), []);

    expect(offers).not.toHaveProperty('shippingDetails');
    expect(offers.hasMerchantReturnPolicy).toMatchObject({
      merchantReturnDays: RETURN_DAYS,
    });
  });

  it('reads low stock as in stock and none as out of stock', () => {
    expect(
      productJsonLd(product({ stock: 1 }), FLAT_FEES).offers.availability,
    ).toBe('https://schema.org/InStock');
    expect(
      productJsonLd(product({ stock: 0 }), FLAT_FEES).offers.availability,
    ).toBe('https://schema.org/OutOfStock');
  });

  it('leaves out what the product does not have, rather than sending nulls', () => {
    const data = productJsonLd(product({ brand: null, images: [] }), FLAT_FEES);

    expect(data).not.toHaveProperty('brand');
    expect(data).not.toHaveProperty('image');
  });

  it('names a family member by its label', () => {
    expect(
      productJsonLd(product({ variantLabel: 'لاوندر' }), FLAT_FEES).name,
    ).toBe('غذای خشک گربه بالغ — لاوندر');
  });
});
