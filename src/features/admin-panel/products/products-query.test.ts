// The list's URL, both ways: what a bad query string degrades to, and what the
// pager writes back. Every filter the admin set has to survive a page step —
// dropping one silently re-lists the whole catalog under the same heading.
import { describe, expect, it } from 'vitest';
import { MAX_SEARCH_TERM_LENGTH } from '@/lib/catalog/product-query';
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
    expect(filters({ active: 'maybe', page: '-4' })).toEqual({
      q: undefined,
      category: undefined,
      active: 'all',
      page: 1,
    });
  });

  it('never hands Postgres a null byte in the search or the category', () => {
    // `pg` rejects U+0000 in a text parameter, and that throw is a 500.
    const nul = String.fromCharCode(0);
    const parsed = filters({ q: `${nul}${nul}`, category: nul });

    expect(parsed.q).toBeFalsy();
    expect(parsed.category).toBeFalsy();
    expect(filters({ q: `غذا${nul}ی خشک` }).q).toBe('غذای خشک');
  });

  it('trims the search and the category, and reads a blank one as none', () => {
    expect(
      filters({ q: '  غذای خشک  ', category: ' dry-food ' }),
    ).toMatchObject({ q: 'غذای خشک', category: 'dry-food' });
    expect(filters({ q: '   ', category: ' ' })).toMatchObject({
      q: undefined,
      category: undefined,
    });
    // Padding does not count toward the cap.
    const atCap = 'ب'.repeat(MAX_SEARCH_TERM_LENGTH);
    expect(filters({ q: ` ${atCap} ` }).q).toBe(atCap);
  });

  it('drops a search longer than the storefront’s cap', () => {
    const atCap = 'ب'.repeat(MAX_SEARCH_TERM_LENGTH);

    expect(filters({ q: atCap }).q).toBe(atCap);
    expect(filters({ q: `${atCap}ب` }).q).toBeUndefined();
  });
});

describe('productsHref', () => {
  it('drops `page` on page one and keeps every filter', () => {
    const href = productsHref(
      filters({ q: 'غذای خشک', category: 'dry-food', page: '3' }),
      1,
    );

    const url = new URL(href, 'https://example.com');
    expect(url.pathname).toBe(PROTECTED_PATHS.PRODUCTS);
    expect(url.searchParams.get('page')).toBeNull();
    expect(url.searchParams.get('q')).toBe('غذای خشک');
    expect(url.searchParams.get('category')).toBe('dry-food');
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
