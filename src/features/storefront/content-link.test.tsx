// The one place a content link picks between in-app navigation and a new tab —
// the security half of an external destination (`noopener noreferrer`) lives
// here, so it is pinned here.
import Link from 'next/link';
import { describe, expect, it } from 'vitest';
import { ContentLink } from './content-link';

describe('ContentLink', () => {
  it('renders a site destination as in-app navigation, in the same tab', () => {
    const link = ContentLink({
      href: '/shop?category=kitchen',
      className: 'cta',
      children: 'فروشگاه',
    });
    expect(link.type).toBe(Link);
    expect(link.props).toEqual({
      href: '/shop?category=kitchen',
      className: 'cta',
      children: 'فروشگاه',
    });
  });

  it('opens an external destination in a new tab, without opener or referrer', () => {
    const link = ContentLink({
      href: 'https://example.com/',
      external: true,
      children: 'راهنما',
    });
    expect(link.type).toBe('a');
    expect(link.props).toEqual({
      href: 'https://example.com/',
      target: '_blank',
      rel: 'noopener noreferrer',
      children: 'راهنما',
    });
  });

  it('keeps the new-tab safety attributes over a caller’s own', () => {
    const link = ContentLink({
      href: 'https://example.com/',
      external: true,
      target: '_self',
      rel: 'opener',
    });
    expect(link.props).toMatchObject({
      target: '_blank',
      rel: 'noopener noreferrer',
    });
  });
});
