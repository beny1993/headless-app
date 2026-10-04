import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_NAME, DEFAULT_SITE_ORIGIN } from '@/constants';
import { PET_TYPES } from '@/lib/catalog/product-query';
import { PATHS, productPath, shopPath } from '@/lib/constant/paths';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  jsonLdHtml,
  purchaseSentence,
  rialForStructuredData,
  SITE_JSON_LD,
  SITE_METADATA,
  SITE_OPEN_GRAPH,
  SITE_TAGLINE,
  SITE_TWITTER,
  sitemapEntries,
} from './seo';

describe('the site share cards', () => {
  it('uses the full Persian shop name in the home title and both full names as aliases', () => {
    expect(SITE_METADATA.title).toMatchObject({
      default: 'پت‌شاپ اسموکی | فروشگاه آنلاین حیوانات خانگی',
    });
    for (const entity of SITE_JSON_LD['@graph']) {
      expect(entity.alternateName).toEqual([
        'پت‌شاپ اسموکی',
        'Smokey Pet Shop',
      ]);
    }
  });

  it('leave the title and description to each page', () => {
    // Next fills a card's empty fields from the page's own title and
    // description; a card that carried the site's would put the home page's
    // on every shelf and on /about.
    for (const card of [SITE_OPEN_GRAPH, SITE_TWITTER]) {
      expect(card).not.toHaveProperty('title');
      expect(card).not.toHaveProperty('description');
    }
  });
});

describe('purchaseSentence', () => {
  it('offers the thing named, from the shop', () => {
    const sentence = purchaseSentence('غذای خشک');

    expect(sentence.startsWith('خرید غذای خشک از ')).toBe(true);
    expect(sentence).toContain(DEFAULT_SITE_NAME);
    expect(sentence).toContain(SITE_TAGLINE);
    expect(sentence.endsWith('.')).toBe(true);
  });
});

describe('absoluteUrl', () => {
  it('puts a path on the shop origin', () => {
    expect(absoluteUrl('/product/royal-canin')).toBe(
      `${DEFAULT_SITE_ORIGIN}/product/royal-canin`,
    );
    expect(absoluteUrl(shopPath({ category: 'dry-food' }))).toBe(
      `${DEFAULT_SITE_ORIGIN}/shop?category=dry-food`,
    );
  });

  it('keeps the trailing slash on the home page, the one the sitemap lists', () => {
    expect(absoluteUrl(PATHS.HOME)).toBe(`${DEFAULT_SITE_ORIGIN}/`);
  });

  it('leaves an absolute URL alone, as an object-storage photo arrives', () => {
    const photo = 'https://storage.example/bucket/uploads/a.jpg';
    expect(absoluteUrl(photo)).toBe(photo);
  });
});

describe('rialForStructuredData', () => {
  it('turns integer Toman into integer Rial', () => {
    expect(rialForStructuredData(285_000)).toBe(2_850_000);
    expect(rialForStructuredData(1)).toBe(10);
  });

  it('stays exact far past any real price', () => {
    const rial = rialForStructuredData(999_999_999_999);
    expect(rial).toBe(9_999_999_999_990);
    expect(Number.isSafeInteger(rial)).toBe(true);
  });
});

describe('jsonLdHtml', () => {
  it('cannot be closed from inside by admin-entered text', () => {
    const data = { name: 'غذا</script><script>alert(1)</script>' };
    const html = jsonLdHtml(data);

    expect(html).not.toContain('<');
    // Still the same data to the parser that reads it.
    expect(JSON.parse(html)).toEqual(data);
  });
});

describe('breadcrumbJsonLd', () => {
  it('numbers the trail from one, on absolute URLs', () => {
    expect(
      breadcrumbJsonLd([
        { name: 'خانه', path: PATHS.HOME },
        { name: 'فروشگاه', path: PATHS.SHOP },
        { name: 'غذای خشک', path: shopPath({ category: 'dry-food' }) },
      ]),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'خانه',
          item: `${DEFAULT_SITE_ORIGIN}/`,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'فروشگاه',
          item: `${DEFAULT_SITE_ORIGIN}/shop`,
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: 'غذای خشک',
          item: `${DEFAULT_SITE_ORIGIN}/shop?category=dry-food`,
        },
      ],
    });
  });
});

describe('SITE_JSON_LD', () => {
  it('names the shop and its logo on absolute URLs', () => {
    const [organization, website] = SITE_JSON_LD['@graph'];

    expect(organization).toMatchObject({
      '@type': 'Organization',
      name: DEFAULT_SITE_NAME,
      url: `${DEFAULT_SITE_ORIGIN}/`,
    });
    expect(organization.logo).toMatch(new RegExp(`^${DEFAULT_SITE_ORIGIN}/`));
    expect(website).toMatchObject({
      '@type': 'WebSite',
      name: DEFAULT_SITE_NAME,
      url: `${DEFAULT_SITE_ORIGIN}/`,
      inLanguage: 'fa-IR',
    });
  });
});

describe('sitemapEntries', () => {
  const updatedAt = new Date('2026-09-20T10:00:00Z');
  const products = [
    { slug: 'royal-canin-adult-cat-dry-food', updatedAt },
    { slug: 'catsan-litter-deodorizer-ocean', updatedAt },
  ];
  const shelves = [
    ...Object.values(PET_TYPES).map((pet) => shopPath({ pet })),
    shopPath({ category: 'dry-food' }),
  ];
  const entries = sitemapEntries(products, shelves);
  const urls = entries.map((entry) => entry.url);

  it('lists the fixed pages, the shelves and the products, each by the URL its canonical names', () => {
    expect(urls).toEqual(
      expect.arrayContaining([
        absoluteUrl(PATHS.HOME),
        absoluteUrl(PATHS.SHOP),
        absoluteUrl(PATHS.ABOUT),
        ...shelves.map(absoluteUrl),
        ...products.map((product) => absoluteUrl(productPath(product.slug))),
      ]),
    );
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toHaveLength(3 + shelves.length + products.length);
    for (const url of urls)
      expect(url.startsWith(DEFAULT_SITE_ORIGIN)).toBe(true);
  });

  it('dates the products by their last change, and nothing else', () => {
    // Google trusts <lastmod> only while it is accurate: a shelf or a fixed
    // page has no last change to report, and "now" would teach Google to
    // distrust the product dates too.
    const dated = entries.filter((entry) => entry.lastModified);

    expect(dated.map((entry) => entry.url)).toEqual(
      products.map((product) => absoluteUrl(productPath(product.slug))),
    );
    expect(dated.map((entry) => entry.lastModified)).toEqual(
      products.map((product) => product.updatedAt),
    );
  });

  it('lists only the fixed pages when given nothing else', () => {
    expect(sitemapEntries([], []).map((entry) => entry.url)).toEqual([
      absoluteUrl(PATHS.HOME),
      absoluteUrl(PATHS.SHOP),
      absoluteUrl(PATHS.ABOUT),
    ]);
  });
});
