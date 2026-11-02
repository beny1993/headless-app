// The footer's social pills: each renders only while its handle is set, the row
// is gone when none is, and every pill is an external link (new tab, no opener)
// to the canonical profile of its bare handle. The show/hide branch lives only
// in JSX, so a render is the one place it can be pinned. next/image renders a
// plain <img> on happy-dom.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Footer } from './footer';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import type { LinkTargets } from '@/lib/content/link';

afterEach(cleanup);

const NO_TARGETS: LinkTargets = { categories: {}, products: {} };
const footer = DEFAULT_CONTENT.footer;
/** The footer once a shop has saved all three handles. */
const withHandles = {
  ...footer,
  social: {
    instagram: 'demo.shop',
    instagramDailies: 'demo.daily',
    telegram: 'demoshop',
  },
};
const pill = (event: string) =>
  document.querySelector<HTMLAnchorElement>(`[data-umami-event="${event}"]`);

describe('Footer social pills', () => {
  it('shows both full shop names alongside saved editorial branding', () => {
    render(
      <Footer
        content={{ ...footer, brand: 'Acme', tagline: 'متن دلخواه فروشگاه' }}
        targets={NO_TARGETS}
      />,
    );
    expect(screen.getByText('فروشگاه نمونه')).toBeTruthy();
    const latin = screen.getByText('Demo Shop');
    expect(latin.getAttribute('lang')).toBe('en');
    expect(latin.getAttribute('dir')).toBe('ltr');
    expect(latin.closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByText('متن دلخواه فروشگاه')).toBeTruthy();
  });

  it('links all three saved handles to their profiles, in a new tab without an opener', () => {
    render(<Footer content={withHandles} targets={NO_TARGETS} />);

    const expected = [
      ['footer-social-instagram-shop', 'https://instagram.com/demo.shop'],
      ['footer-social-instagram-dailies', 'https://instagram.com/demo.daily'],
      ['footer-social-telegram', 'https://t.me/demoshop'],
    ] as const;
    for (const [event, href] of expected) {
      const link = pill(event);
      expect(link?.getAttribute('href'), event).toBe(href);
      expect(link?.getAttribute('target'), event).toBe('_blank');
      expect(link?.getAttribute('rel'), event).toBe('noopener noreferrer');
    }
    expect(screen.getByRole('list', { name: 'شبکه‌های اجتماعی' })).toBeTruthy();
  });

  it('drops a pill whose handle is cleared, and the row once all are', () => {
    const { unmount } = render(
      <Footer
        content={{
          ...withHandles,
          social: { ...withHandles.social, telegram: '' },
        }}
        targets={NO_TARGETS}
      />,
    );
    expect(pill('footer-social-telegram')).toBeNull();
    expect(pill('footer-social-instagram-shop')).not.toBeNull();
    expect(pill('footer-social-instagram-dailies')).not.toBeNull();
    unmount();

    render(
      <Footer
        content={{
          ...footer,
          social: { instagram: '', instagramDailies: '', telegram: '' },
        }}
        targets={NO_TARGETS}
      />,
    );
    expect(screen.queryByRole('list', { name: 'شبکه‌های اجتماعی' })).toBeNull();
    expect(
      document.querySelector('[data-umami-event^="footer-social-"]'),
    ).toBeNull();
  });

  it('shows no row on a fresh shop, whose defaults carry no handle', () => {
    render(<Footer content={footer} targets={NO_TARGETS} />);

    expect(screen.queryByRole('list', { name: 'شبکه‌های اجتماعی' })).toBeNull();
  });
});
