import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHOP_QUERY,
  buildShopHref,
  parseShopQuery,
  shopPageWindow,
  toggleShopCategory,
  toggleShopPet,
  updateShopQuery,
  type ShopQuery,
} from '@/features/storefront/shop/shop-query';

/** `buildShopHref` returns a path; parsing it back needs its query half. */
const hrefParams = (href: string) =>
  new URL(href, 'http://shop.test').searchParams;

describe('parseShopQuery', () => {
  it('answers an empty query with the defaults', () => {
    expect(parseShopQuery({})).toEqual(DEFAULT_SHOP_QUERY);
    expect(parseShopQuery(new URLSearchParams())).toEqual(DEFAULT_SHOP_QUERY);
  });

  it('reads a full, valid query', () => {
    expect(
      parseShopQuery({
        category: 'dry-food',
        pet: 'cat',
        minPrice: '100000',
        maxPrice: '500000',
        sort: 'price-asc',
        page: '3',
        limit: '24',
      }),
    ).toEqual({
      category: 'dry-food',
      pet: 'cat',
      minPrice: 100_000,
      maxPrice: 500_000,
      sort: 'price-asc',
      page: 3,
      limit: 24,
    });
  });

  it('ignores parameters it does not own', () => {
    // Marketing and analytics links carry their own params; they must not
    // change what the shop renders, and must not be an error either.
    expect(
      parseShopQuery({ utm_source: 'telegram', q: 'گربه', view: 'list' }),
    ).toEqual(DEFAULT_SHOP_QUERY);
  });

  describe('category', () => {
    it('keeps a slug', () => {
      expect(parseShopQuery({ category: 'toys' }).category).toBe('toys');
    });

    it('keeps a slug the catalog has never heard of', () => {
      // Deliberately not validated against the category list: the API does not
      // either, and the honest answer to `?category=nope` is an empty result,
      // not a silently broader search.
      expect(parseShopQuery({ category: 'nope' }).category).toBe('nope');
    });

    it('drops an empty or blank slug', () => {
      expect(parseShopQuery({ category: '' }).category).toBeUndefined();
      expect(parseShopQuery({ category: '   ' }).category).toBeUndefined();
    });

    it('trims surrounding whitespace', () => {
      expect(parseShopQuery({ category: ' toys ' }).category).toBe('toys');
    });
  });

  describe('pet', () => {
    it('keeps the two the catalog has', () => {
      expect(parseShopQuery({ pet: 'cat' }).pet).toBe('cat');
      expect(parseShopQuery({ pet: 'dog' }).pet).toBe('dog');
    });

    it('drops anything else, exact case only', () => {
      expect(parseShopQuery({ pet: 'bird' }).pet).toBeUndefined();
      expect(parseShopQuery({ pet: 'CAT' }).pet).toBeUndefined();
      expect(parseShopQuery({ pet: '' }).pet).toBeUndefined();
    });
  });

  describe('sort', () => {
    it('keeps every ordering the API offers', () => {
      expect(parseShopQuery({ sort: 'newest' }).sort).toBe('newest');
      expect(parseShopQuery({ sort: 'price-asc' }).sort).toBe('price-asc');
      expect(parseShopQuery({ sort: 'price-desc' }).sort).toBe('price-desc');
    });

    it('falls back to newest for an ordering that does not exist', () => {
      expect(parseShopQuery({ sort: 'cheapest' }).sort).toBe('newest');
      expect(parseShopQuery({ sort: '' }).sort).toBe('newest');
    });
  });

  describe('price bounds', () => {
    it('keeps integer Toman bounds', () => {
      const query = parseShopQuery({ minPrice: '90000', maxPrice: '250000' });
      expect(query.minPrice).toBe(90_000);
      expect(query.maxPrice).toBe(250_000);
    });

    it('treats a zero minimum as the real floor it is', () => {
      expect(parseShopQuery({ minPrice: '0' }).minPrice).toBe(0);
    });

    it('drops a zero maximum, which can only ever match nothing', () => {
      // `price > 0` is a CHECK constraint, so `maxPrice=0` is the empty field
      // an over-eager form leaves behind, not a filter anyone meant.
      expect(parseShopQuery({ maxPrice: '0' }).maxPrice).toBeUndefined();
    });

    it('drops a negative bound', () => {
      expect(parseShopQuery({ minPrice: '-1' }).minPrice).toBeUndefined();
      expect(parseShopQuery({ maxPrice: '-500' }).maxPrice).toBeUndefined();
    });

    it('drops a non-integer bound rather than rounding money', () => {
      expect(parseShopQuery({ minPrice: '12.5' }).minPrice).toBeUndefined();
      expect(parseShopQuery({ maxPrice: '1e5' }).maxPrice).toBe(100_000);
    });

    it('drops what is not a number at all', () => {
      expect(parseShopQuery({ minPrice: 'abc' }).minPrice).toBeUndefined();
      expect(parseShopQuery({ maxPrice: 'Infinity' }).maxPrice).toBeUndefined();
      // Persian digits never reach here from our own links, and a hand-typed
      // «۱۰۰» must degrade to "no bound" rather than throw.
      expect(parseShopQuery({ minPrice: '۱۰۰' }).minPrice).toBeUndefined();
    });

    it('drops an empty bound, which is a cleared field', () => {
      expect(parseShopQuery({ minPrice: '', maxPrice: '' })).toEqual(
        DEFAULT_SHOP_QUERY,
      );
    });

    it('keeps an inverted range as given', () => {
      // The API would answer this with an empty page and so do we — swapping
      // the bounds would be inventing an intent the URL never stated.
      const query = parseShopQuery({ minPrice: '500000', maxPrice: '1000' });
      expect(query.minPrice).toBe(500_000);
      expect(query.maxPrice).toBe(1000);
    });
  });

  describe('page', () => {
    it('keeps a one-based page', () => {
      expect(parseShopQuery({ page: '3' }).page).toBe(3);
    });

    it('falls back to the first page for anything below one', () => {
      expect(parseShopQuery({ page: '0' }).page).toBe(1);
      expect(parseShopQuery({ page: '-2' }).page).toBe(1);
    });

    it('falls back to the first page for a non-integer or non-number', () => {
      expect(parseShopQuery({ page: '1.5' }).page).toBe(1);
      expect(parseShopQuery({ page: 'abc' }).page).toBe(1);
    });

    it('keeps a page past the end of the catalog', () => {
      // Out-of-range is the page component's story to tell (it renders the
      // "past the last page" empty state); parsing must not hide it.
      expect(parseShopQuery({ page: '999' }).page).toBe(999);
    });
  });

  describe('limit', () => {
    it('keeps a page size within the cap', () => {
      expect(parseShopQuery({ limit: '4' }).limit).toBe(4);
      expect(parseShopQuery({ limit: '48' }).limit).toBe(48);
    });

    it('drops an over-cap page size instead of clamping it', () => {
      // The API rejects 500 rather than answering with 48, because answering
      // hides the caller's bug behind a plausible page. Dropping to the default
      // is the same refusal in a form a page can still render.
      expect(parseShopQuery({ limit: '49' }).limit).toBe(
        DEFAULT_SHOP_QUERY.limit,
      );
      expect(parseShopQuery({ limit: '500' }).limit).toBe(
        DEFAULT_SHOP_QUERY.limit,
      );
    });

    it('drops a page size below one', () => {
      expect(parseShopQuery({ limit: '0' }).limit).toBe(
        DEFAULT_SHOP_QUERY.limit,
      );
      expect(parseShopQuery({ limit: '-3' }).limit).toBe(
        DEFAULT_SHOP_QUERY.limit,
      );
    });

    it('drops a non-integer page size', () => {
      expect(parseShopQuery({ limit: '2.5' }).limit).toBe(
        DEFAULT_SHOP_QUERY.limit,
      );
      expect(parseShopQuery({ limit: 'all' }).limit).toBe(
        DEFAULT_SHOP_QUERY.limit,
      );
    });
  });

  describe('repeated parameters', () => {
    it('takes the first value, as URLSearchParams.get does', () => {
      expect(parseShopQuery({ pet: ['cat', 'dog'] }).pet).toBe('cat');
      expect(parseShopQuery({ category: ['toys', 'treats'] }).category).toBe(
        'toys',
      );
    });

    it('drops a repeated parameter whose first value is invalid', () => {
      expect(parseShopQuery({ pet: ['bird', 'cat'] }).pet).toBeUndefined();
    });

    it('reads an array-shaped empty list as absent', () => {
      expect(parseShopQuery({ pet: [] })).toEqual(DEFAULT_SHOP_QUERY);
    });
  });
});

describe('buildShopHref', () => {
  it('is the bare shop path for the default query', () => {
    expect(buildShopHref(DEFAULT_SHOP_QUERY)).toBe('/shop');
  });

  it('omits every default rather than spelling it out', () => {
    // A cleared filter set and a fresh visit must produce the same URL, or
    // "shareable link" means two links for one screen.
    expect(
      buildShopHref({ ...DEFAULT_SHOP_QUERY, sort: 'newest', page: 1 }),
    ).toBe('/shop');
  });

  it('writes the filters in a stable order', () => {
    expect(
      buildShopHref({
        category: 'dry-food',
        pet: 'dog',
        minPrice: 50_000,
        maxPrice: 300_000,
        sort: 'price-desc',
        page: 2,
        limit: 24,
      }),
    ).toBe(
      '/shop?category=dry-food&pet=dog&minPrice=50000&maxPrice=300000&sort=price-desc&page=2&limit=24',
    );
  });

  it('writes a zero minimum, which is a value and not an absence', () => {
    expect(buildShopHref({ ...DEFAULT_SHOP_QUERY, minPrice: 0 })).toBe(
      '/shop?minPrice=0',
    );
  });

  it('encodes a value with URL-significant characters', () => {
    expect(buildShopHref({ ...DEFAULT_SHOP_QUERY, category: 'a&b=c' })).toBe(
      '/shop?category=a%26b%3Dc',
    );
  });

  it('matches the deep-link shape the rest of the site builds', () => {
    // `shopPath` (home quiz, category tiles) writes `?category=…&pet=…`; a
    // deep link must arrive with those filters active, so the two spellings
    // have to agree exactly.
    expect(
      buildShopHref({
        ...DEFAULT_SHOP_QUERY,
        category: 'supplements',
        pet: 'cat',
      }),
    ).toBe('/shop?category=supplements&pet=cat');
  });
});

describe('shop query round trip', () => {
  const cases: ShopQuery[] = [
    DEFAULT_SHOP_QUERY,
    { ...DEFAULT_SHOP_QUERY, category: 'toys' },
    { ...DEFAULT_SHOP_QUERY, pet: 'dog' },
    { ...DEFAULT_SHOP_QUERY, minPrice: 0 },
    { ...DEFAULT_SHOP_QUERY, minPrice: 90_000, maxPrice: 250_000 },
    { ...DEFAULT_SHOP_QUERY, sort: 'price-asc' },
    { ...DEFAULT_SHOP_QUERY, sort: 'price-desc', page: 4 },
    { ...DEFAULT_SHOP_QUERY, limit: 48 },
    {
      category: 'wet-food',
      pet: 'cat',
      minPrice: 10_000,
      maxPrice: 999_000,
      sort: 'price-desc',
      page: 7,
      limit: 6,
    },
  ];

  it.each(cases)('survives state → URL → state: %o', (query) => {
    expect(parseShopQuery(hrefParams(buildShopHref(query)))).toEqual(query);
  });

  it('normalizes a hand-written URL to the same state its href produces', () => {
    const messy = parseShopQuery({
      category: 'toys',
      pet: 'lizard',
      sort: 'cheapest',
      page: '0',
      limit: '900',
      utm_campaign: 'nowruz',
    });

    expect(buildShopHref(messy)).toBe('/shop?category=toys');
    expect(parseShopQuery(hrefParams(buildShopHref(messy)))).toEqual(messy);
  });
});

describe('updateShopQuery', () => {
  const listing: ShopQuery = {
    ...DEFAULT_SHOP_QUERY,
    category: 'toys',
    page: 5,
  };

  it('returns to the first page whenever a filter changes', () => {
    // Page 5 of "toys" is not page 5 of "cat toys"; keeping the number would
    // land the shopper on an empty page they never asked for.
    expect(updateShopQuery(listing, { pet: 'cat' })).toEqual({
      ...listing,
      pet: 'cat',
      page: 1,
    });
  });

  it('returns to the first page when the sort changes', () => {
    expect(updateShopQuery(listing, { sort: 'price-asc' }).page).toBe(1);
  });

  it('keeps the page the caller explicitly asks for', () => {
    expect(updateShopQuery(listing, { page: 2 }).page).toBe(2);
  });

  it('clears a filter that is patched to undefined', () => {
    const cleared = updateShopQuery(listing, { category: undefined });
    expect(cleared.category).toBeUndefined();
    expect(cleared.page).toBe(1);
  });

  it('leaves the original untouched', () => {
    updateShopQuery(listing, { pet: 'dog' });
    expect(listing).toEqual({
      ...DEFAULT_SHOP_QUERY,
      category: 'toys',
      page: 5,
    });
  });
});

describe('toggleShopCategory', () => {
  it('selects when nothing is selected', () => {
    expect(toggleShopCategory(DEFAULT_SHOP_QUERY, 'toys').category).toBe(
      'toys',
    );
  });

  it('replaces the selection rather than accumulating one', () => {
    // The API takes exactly one category slug. Checkbox UI, radio semantics.
    const query = toggleShopCategory(DEFAULT_SHOP_QUERY, 'toys');
    expect(toggleShopCategory(query, 'treats').category).toBe('treats');
  });

  it('clears when the selected one is clicked again', () => {
    const query = toggleShopCategory(DEFAULT_SHOP_QUERY, 'toys');
    expect(toggleShopCategory(query, 'toys').category).toBeUndefined();
  });

  it('returns to the first page', () => {
    const deep = { ...DEFAULT_SHOP_QUERY, page: 3 };
    expect(toggleShopCategory(deep, 'toys').page).toBe(1);
  });
});

describe('toggleShopPet', () => {
  it('selects, replaces and clears the same way', () => {
    const cat = toggleShopPet(DEFAULT_SHOP_QUERY, 'cat');
    expect(cat.pet).toBe('cat');
    expect(toggleShopPet(cat, 'dog').pet).toBe('dog');
    expect(toggleShopPet(cat, 'cat').pet).toBeUndefined();
  });

  it('returns to the first page', () => {
    expect(toggleShopPet({ ...DEFAULT_SHOP_QUERY, page: 9 }, 'dog').page).toBe(
      1,
    );
  });
});

describe('shopPageWindow', () => {
  it('is empty when nothing matched', () => {
    expect(shopPageWindow(1, 0)).toEqual([]);
  });

  it('is a single page when everything fits on one', () => {
    expect(shopPageWindow(1, 1)).toEqual([1]);
  });

  it('lists every page while they fit in the window', () => {
    expect(shopPageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('centres the window on the current page', () => {
    expect(shopPageWindow(6, 10)).toEqual([4, 5, 6, 7, 8]);
  });

  it('hugs the start without running off it', () => {
    expect(shopPageWindow(1, 10)).toEqual([1, 2, 3, 4, 5]);
    expect(shopPageWindow(2, 10)).toEqual([1, 2, 3, 4, 5]);
  });

  it('hugs the end without running past it', () => {
    expect(shopPageWindow(10, 10)).toEqual([6, 7, 8, 9, 10]);
    expect(shopPageWindow(9, 10)).toEqual([6, 7, 8, 9, 10]);
  });

  it('stays inside the catalog for a page past the end', () => {
    // `?page=999` reaches here intact; the window must still point at pages
    // that exist so the shopper has a way back.
    expect(shopPageWindow(999, 3)).toEqual([1, 2, 3]);
  });

  it('stays inside the catalog for a page below the first', () => {
    expect(shopPageWindow(0, 3)).toEqual([1, 2, 3]);
  });

  it('honours a caller-chosen window size', () => {
    expect(shopPageWindow(5, 10, 3)).toEqual([4, 5, 6]);
    expect(shopPageWindow(5, 10, 1)).toEqual([5]);
  });
});
