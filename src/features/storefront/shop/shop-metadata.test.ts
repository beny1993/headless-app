import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_ORIGIN } from '@/constants';
import { PRODUCT_SORTS } from '@/lib/catalog/product-query';
import { absoluteUrl } from '@/lib/seo';
import { PATHS, shopPath } from '@/lib/constant/paths';
import { shopMetadata } from './shop-metadata';
import { parseShopQuery } from './shop-query';

const categories = [
  { slug: 'dry-food', title: 'غذای خشک' },
  { slug: 'treats', title: 'تشویقی' },
];

/** The metadata for a URL's query string, parsed by the page's own parser. */
const metadataFor = (params: Record<string, string>) =>
  shopMetadata(parseShopQuery(params), categories);

const NOT_INDEXED = { index: false, follow: true };

describe('shopMetadata', () => {
  it('leaves the plain shop on the site title and points it at itself', () => {
    const metadata = metadataFor({});

    expect(metadata.title).toBe('فروشگاه');
    expect(metadata.alternates?.canonical).toBe(`${DEFAULT_SITE_ORIGIN}/shop`);
    expect(metadata).not.toHaveProperty('robots');
  });

  it('titles a category shelf by its category, at the URL the sitemap lists', () => {
    const metadata = metadataFor({ category: 'dry-food' });

    expect(metadata.title).toBe('غذای خشک');
    expect(metadata.description).toContain('غذای خشک');
    expect(metadata.alternates?.canonical).toBe(
      absoluteUrl(shopPath({ category: 'dry-food' })),
    );
  });

  it('titles a pet shelf by its pet', () => {
    const metadata = metadataFor({ pet: 'cat' });

    expect(metadata.title).toBe('محصولات گربه');
    expect(metadata.alternates?.canonical).toBe(
      absoluteUrl(shopPath({ pet: 'cat' })),
    );
  });

  it('names both on a shelf with both, in one fixed order', () => {
    const metadata = metadataFor({ pet: 'dog', category: 'treats' });

    expect(metadata.title).toBe('تشویقی سگ');
    expect(metadata.alternates?.canonical).toBe(
      `${DEFAULT_SITE_ORIGIN}/shop?category=treats&pet=dog`,
    );
  });

  it('points every sort order and price range of a shelf at the one shelf', () => {
    expect(
      metadataFor({
        category: 'dry-food',
        sort: PRODUCT_SORTS.PRICE_ASC,
        minPrice: '100000',
        maxPrice: '900000',
      }).alternates?.canonical,
    ).toBe(absoluteUrl(shopPath({ category: 'dry-food' })));
  });

  it('keeps a later page as a page of its own, and page one as the shelf', () => {
    expect(
      metadataFor({ category: 'dry-food', page: '2' }).alternates?.canonical,
    ).toBe(`${DEFAULT_SITE_ORIGIN}/shop?category=dry-food&page=2`);
    expect(metadataFor({ page: '1' }).alternates?.canonical).toBe(
      absoluteUrl(PATHS.SHOP),
    );
  });

  it('keeps a search out of the index, with no canonical to contradict it', () => {
    const metadata = metadataFor({ q: 'غذا', category: 'dry-food' });

    expect(metadata.robots).toEqual(NOT_INDEXED);
    expect(metadata).not.toHaveProperty('alternates');
  });

  it('keeps an unknown category out of the index: it lists nothing', () => {
    const metadata = metadataFor({ category: 'no-such-category' });

    expect(metadata.robots).toEqual(NOT_INDEXED);
    expect(metadata).not.toHaveProperty('alternates');
    expect(metadata.title).toBe('فروشگاه');
  });
});
