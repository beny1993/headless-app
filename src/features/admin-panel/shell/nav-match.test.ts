import { describe, expect, it } from 'vitest';
import { activeHref, type NavMatch } from './nav-match';

const items: NavMatch[] = [
  { href: '/admin-panel', match: 'exact' },
  { href: '/admin-panel/products', match: 'prefix' },
  { href: '/admin-panel/products/categories', match: 'prefix' },
  { href: '/admin-panel/content/home', match: 'exact' },
];

describe('activeHref', () => {
  it('activates the dashboard only on its exact path', () => {
    expect(activeHref('/admin-panel', items)).toBe('/admin-panel');
    expect(activeHref('/admin-panel/orders', items)).toBeNull();
  });

  it.each([
    '/admin-panel/products',
    '/admin-panel/products/new',
    '/admin-panel/products/123e4567-e89b-12d3-a456-426614174000',
  ])('activates products on %s', (pathname) => {
    expect(activeHref(pathname, items)).toBe('/admin-panel/products');
  });

  it('activates categories, not products, on the categories page', () => {
    expect(activeHref('/admin-panel/products/categories', items)).toBe(
      '/admin-panel/products/categories',
    );
  });

  it('does not treat a shared string prefix as a sub-path', () => {
    expect(activeHref('/admin-panel/products-archive', items)).toBeNull();
  });

  it('matches an exact item only exactly', () => {
    expect(activeHref('/admin-panel/content/home', items)).toBe(
      '/admin-panel/content/home',
    );
    expect(activeHref('/admin-panel/content/home/extra', items)).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(activeHref('/shop', items)).toBeNull();
  });
});
