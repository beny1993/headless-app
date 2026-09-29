import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_ORIGIN } from '@/constants';
import { PRODUCT_SORTS } from '@/lib/catalog/product-query';
import { absoluteUrl, purchaseSentence } from '@/lib/seo';
import { PATHS, shopPath } from '@/lib/constant/paths';
import { SHOP_TITLE, shelfTitle, shopMetadata } from './shop-metadata';
import { buildShopHref, parseShopQuery, updateShopQuery } from './shop-query';

const categories = [
  { slug: 'dry-food', title: 'غذای خشک' },
  { slug: 'treats', title: 'تشویقی' },
  // An admin may title a category anything, the shop's own word included.
  { slug: 'shop-cat', title: 'فروشگاه' },
];

/**
 * The metadata for a URL's query string, parsed by the page's own parser, on a
 * page that lists something unless said otherwise.
 */
const metadataFor = (params: Record<string, string>, listed = true) =>
  shopMetadata(parseShopQuery(params), categories, listed);

const NOT_INDEXED = { index: false, follow: true };

describe('shelfTitle', () => {
  it('names what a shelf lists, and nothing for the whole shop', () => {
    const titleFor = (params: Record<string, string>) =>
      shelfTitle(parseShopQuery(params), categories);

    expect(titleFor({ category: 'dry-food' })).toBe('غذای خشک');
    expect(titleFor({ pet: 'cat' })).toBe('محصولات گربه');
    expect(titleFor({ pet: 'dog', category: 'treats' })).toBe('تشویقی سگ');
    expect(titleFor({})).toBeUndefined();
    // A slug that names no category names no shelf, whatever the pet.
    expect(
      titleFor({ category: 'no-such-category', pet: 'cat' }),
    ).toBeUndefined();
  });
});

describe('shopMetadata', () => {
  it('leaves the plain shop on the site description and points it at itself', () => {
    const metadata = metadataFor({});

    expect(metadata.title).toBe(SHOP_TITLE);
    expect(metadata.alternates?.canonical).toBe(`${DEFAULT_SITE_ORIGIN}/shop`);
    expect(metadata).not.toHaveProperty('robots');
    expect(metadata).not.toHaveProperty('description');
  });

  it('titles and describes a category shelf by its category, at the URL the sitemap lists', () => {
    const metadata = metadataFor({ category: 'dry-food' });

    expect(metadata.title).toBe('غذای خشک');
    expect(metadata.description).toBe(purchaseSentence('غذای خشک'));
    expect(metadata.alternates?.canonical).toBe(
      absoluteUrl(shopPath({ category: 'dry-food' })),
    );
  });

  it('titles a pet shelf by its pet, and a shelf with both by both, in one fixed order', () => {
    expect(metadataFor({ pet: 'cat' })).toMatchObject({
      title: 'محصولات گربه',
      alternates: { canonical: absoluteUrl(shopPath({ pet: 'cat' })) },
    });
    expect(metadataFor({ pet: 'dog', category: 'treats' })).toMatchObject({
      title: 'تشویقی سگ',
      alternates: {
        canonical: `${DEFAULT_SITE_ORIGIN}/shop?category=treats&pet=dog`,
      },
    });
  });

  it('describes a category titled like the shop itself', () => {
    expect(metadataFor({ category: 'shop-cat' }).description).toBe(
      purchaseSentence('فروشگاه'),
    );
  });

  it('points a later page at itself, at the URL the pager links to', () => {
    const shelf = parseShopQuery({ category: 'dry-food' });

    expect(metadataFor({ category: 'dry-food', page: '2' }).alternates).toEqual(
      {
        canonical: absoluteUrl(
          buildShopHref(updateShopQuery(shelf, { page: 2 })),
        ),
      },
    );
    expect(metadataFor({ page: '1' }).alternates?.canonical).toBe(
      absoluteUrl(PATHS.SHOP),
    );
  });

  it.each([
    ['a sort order', { sort: PRODUCT_SORTS.PRICE_ASC }],
    ['a price range', { minPrice: '100000', maxPrice: '900000' }],
    ['a page size', { limit: '24' }],
    ['a sorted later page', { sort: PRODUCT_SORTS.PRICE_ASC, page: '2' }],
    ['the in-stock-only switch', { inStock: 'true' }],
  ])(
    'keeps %s of a shelf out of the index, with no canonical to contradict it',
    (_, view) => {
      // A view lists other products than the shelf's own page does, so a
      // canonical to the shelf would name a page that is not its duplicate.
      const metadata = metadataFor({ category: 'dry-food', ...view });

      expect(metadata.robots).toEqual(NOT_INDEXED);
      expect(metadata).not.toHaveProperty('alternates');
      // Still the shelf in the tab, and in a shared link's preview.
      expect(metadata.title).toBe('غذای خشک');
      expect(metadata.description).toBe(purchaseSentence('غذای خشک'));
    },
  );

  it('indexes a switched-off in-stock flag as the plain shelf it lists', () => {
    // Off is the default, so the listing is the shelf's own and the canonical
    // is the shelf — not a view to keep out of the index.
    const metadata = metadataFor({ category: 'dry-food', inStock: 'false' });

    expect(metadata).not.toHaveProperty('robots');
    expect(metadata.alternates?.canonical).toBe(
      absoluteUrl(shopPath({ category: 'dry-food' })),
    );
  });

  it('keeps a search out of the index, with no canonical', () => {
    const metadata = metadataFor({ q: 'غذا', category: 'dry-food' });

    expect(metadata.robots).toEqual(NOT_INDEXED);
    expect(metadata).not.toHaveProperty('alternates');
    expect(metadata.description).toBe(purchaseSentence('غذای خشک'));
  });

  it('keeps a page that lists nothing out of the index: an emptied shelf, a page past the end', () => {
    const emptied = metadataFor({ category: 'dry-food' }, false);
    const pastTheEnd = metadataFor({ page: '999' }, false);

    for (const metadata of [emptied, pastTheEnd]) {
      expect(metadata.robots).toEqual(NOT_INDEXED);
      expect(metadata).not.toHaveProperty('alternates');
    }
    expect(emptied.description).toBe(purchaseSentence('غذای خشک'));
    // The whole shop, as on its first page: the site description.
    expect(pastTheEnd).not.toHaveProperty('description');
  });

  it('keeps an unknown category out of the index, under the shop title', () => {
    const metadata = metadataFor({ category: 'no-such-category' }, false);

    expect(metadata.robots).toEqual(NOT_INDEXED);
    expect(metadata.title).toBe(SHOP_TITLE);
    expect(metadata).not.toHaveProperty('description');
  });
});
