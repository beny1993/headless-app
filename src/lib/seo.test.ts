import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_NAME, DEFAULT_SITE_ORIGIN } from '@/constants';
import { PET_TYPES } from '@/lib/catalog/product-query';
import { PATHS, productPath, shopPath } from '@/lib/constant/paths';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  jsonLdHtml,
  rialForStructuredData,
  SITE_JSON_LD,
  sitemapEntries,
} from './seo';

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
  const entries = sitemapEntries(
    [
      { slug: 'royal-canin-adult-cat-dry-food', updatedAt },
      { slug: 'catsan-litter-deodorizer-ocean', updatedAt },
    ],
    [{ slug: 'dry-food' }, { slug: 'malt' }],
  );
  const urls = entries.map((entry) => entry.url);

  it('lists every page by the URL its own canonical names', () => {
    expect(urls).toEqual(
      expect.arrayContaining([
        absoluteUrl(PATHS.HOME),
        absoluteUrl(PATHS.SHOP),
        absoluteUrl(PATHS.ABOUT),
        absoluteUrl(productPath('royal-canin-adult-cat-dry-food')),
        absoluteUrl(productPath('catsan-litter-deodorizer-ocean')),
        absoluteUrl(shopPath({ category: 'dry-food' })),
        absoluteUrl(shopPath({ category: 'malt' })),
        ...Object.values(PET_TYPES).map((pet) =>
          absoluteUrl(shopPath({ pet })),
        ),
      ]),
    );
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toHaveLength(3 + 2 + 2 + Object.values(PET_TYPES).length);
    for (const url of urls)
      expect(url.startsWith(DEFAULT_SITE_ORIGIN)).toBe(true);
  });

  it('dates each product by its last change', () => {
    const product = entries.find(
      (entry) =>
        entry.url ===
        absoluteUrl(productPath('catsan-litter-deodorizer-ocean')),
    );
    expect(product?.lastModified).toEqual(updatedAt);
  });

  it('still lists the fixed pages for an empty catalogue', () => {
    expect(sitemapEntries([], []).map((entry) => entry.url)).toEqual(
      expect.arrayContaining([
        absoluteUrl(PATHS.HOME),
        absoluteUrl(PATHS.SHOP),
        absoluteUrl(PATHS.ABOUT),
      ]),
    );
  });
});
