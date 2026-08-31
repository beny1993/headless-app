import { describe, expect, it } from 'vitest';
import { PATHS, productPath, shopPath } from '@/lib/constant/paths';

describe('productPath', () => {
  it('builds the storefront path for a slug', () => {
    expect(productPath('cat-dry-food')).toBe('/product/cat-dry-food');
  });

  it('encodes a slug that would otherwise break the URL', () => {
    // Catalog slugs are `[a-z0-9-]`, but this takes whatever a caller hands it
    // — a raw `?` or `#` would silently truncate the path into a query string.
    expect(productPath('a b?c#d')).toBe('/product/a%20b%3Fc%23d');
  });
});

describe('shopPath', () => {
  it('is the bare shop path when nothing is filtered', () => {
    expect(shopPath()).toBe(PATHS.SHOP);
    expect(shopPath({})).toBe(PATHS.SHOP);
  });

  it('carries one filter', () => {
    expect(shopPath({ category: 'toys' })).toBe('/shop?category=toys');
    expect(shopPath({ pet: 'dog' })).toBe('/shop?pet=dog');
  });

  it('carries both filters in a stable order', () => {
    // Stable so the deep links are diffable and cacheable, and so the quiz
    // test can assert an exact href.
    expect(shopPath({ category: 'supplements', pet: 'cat' })).toBe(
      '/shop?category=supplements&pet=cat',
    );
  });

  it('omits an empty or absent filter rather than sending a blank param', () => {
    // `?category=` is a real parameter to the API and its schema rejects it —
    // an unanswered question must drop out of the URL entirely.
    expect(shopPath({ category: '', pet: undefined })).toBe(PATHS.SHOP);
  });

  it('encodes a value with URL-significant characters', () => {
    expect(shopPath({ category: 'a&b=c' })).toBe('/shop?category=a%26b%3Dc');
  });
});
