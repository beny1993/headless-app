// The mobile menu renders the links the navbar resolved, and an external one must
// open in a new tab here too, not only on the desktop bar. A closed <dialog>'s
// content is still in the DOM, so no open/close choreography is needed to see it.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MobileMenu } from './mobile-menu';

afterEach(cleanup);

describe('MobileMenu links', () => {
  it('opens an external destination in a new tab and keeps a site one in-app', () => {
    const { container } = render(
      <MobileMenu
        links={[
          { label: 'فروشگاه', href: '/shop?category=kitchen', external: false },
          {
            label: 'راهنما',
            href: 'https://example.com/guide',
            external: true,
          },
        ]}
      />,
    );
    const anchor = (label: string) =>
      [...container.querySelectorAll('a')].find((a) => a.textContent === label);

    expect(anchor('راهنما')?.getAttribute('href')).toBe(
      'https://example.com/guide',
    );
    expect(anchor('راهنما')?.getAttribute('target')).toBe('_blank');
    expect(anchor('راهنما')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchor('فروشگاه')?.getAttribute('href')).toBe(
      '/shop?category=kitchen',
    );
    expect(anchor('فروشگاه')?.hasAttribute('target')).toBe(false);
  });
});
