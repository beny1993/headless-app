// The list's URL, both ways: what a bad query string degrades to, and what the
// pager writes back. Every filter the admin set has to survive a page step —
// dropping one silently re-lists the whole catalog under the same heading.
import { describe, expect, it } from 'vitest';
import { PROTECTED_PATHS } from '@/lib/constant/paths';
import {
  activeToFilter,
  adminProductFilterSchema,
  productsHref,
} from './products-query';

const filters = (raw: Record<string, string>) =>
  adminProductFilterSchema.parse(raw);

describe('adminProductFilterSchema', () => {
  it('degrades a nonsense query to the unfiltered first page', () => {
    expect(filters({ pet: 'parrot', active: 'maybe', page: '-4' })).toEqual({
      q: undefined,
      category: undefined,
      pet: undefined,
      active: 'all',
      page: 1,
    });
  });
});

describe('productsHref', () => {
  it('drops `page` on page one and keeps every filter', () => {
    const href = productsHref(
      filters({ q: 'غذای خشک', category: 'dry-food', pet: 'cat', page: '3' }),
      1,
    );

    const url = new URL(href, 'https://example.com');
    expect(url.pathname).toBe(PROTECTED_PATHS.PRODUCTS);
    expect(url.searchParams.get('page')).toBeNull();
    expect(url.searchParams.get('q')).toBe('غذای خشک');
    expect(url.searchParams.get('category')).toBe('dry-food');
    expect(url.searchParams.get('pet')).toBe('cat');
  });

  it('writes a later page and leaves `active=all` out of the URL', () => {
    const url = new URL(
      productsHref(filters({ active: 'all' }), 4),
      'https://example.com',
    );

    expect(url.searchParams.get('page')).toBe('4');
    expect(url.searchParams.get('active')).toBeNull();
  });

  it('carries a real `active` filter across the page step', () => {
    const url = new URL(
      productsHref(filters({ active: 'inactive' }), 2),
      'https://example.com',
    );

    expect(url.searchParams.get('active')).toBe('inactive');
  });

  it('returns the bare list path when nothing is filtered on page one', () => {
    expect(productsHref(filters({}), 1)).toBe(PROTECTED_PATHS.PRODUCTS);
  });
});

describe('activeToFilter', () => {
  it('maps the URL tri-state to the DAO flag', () => {
    expect(activeToFilter('all')).toBeUndefined();
    expect(activeToFilter('active')).toBe(true);
    expect(activeToFilter('inactive')).toBe(false);
  });
});
