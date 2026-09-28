import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_ORIGIN } from '@/constants';
import { API_ROOT, PATHS, PROTECTED_PATHS } from '@/lib/constant/paths';
import { SITE_METADATA } from '@/lib/seo';
import robots from './robots';

// The sitemap reads the catalogue now: its URLs and dates are pinned in
// src/lib/seo.test.ts (`sitemapEntries`), what it lists while open or closed
// in src/app/sitemap.test.ts, and the served route by e2e/seo.spec.ts.

describe('storefront SEO metadata', () => {
  it('publishes Persian discovery and social-sharing metadata', () => {
    expect(SITE_METADATA.metadataBase?.toString()).toBe(
      `${DEFAULT_SITE_ORIGIN}/`,
    );
    expect(SITE_METADATA.description).toContain('غذا');
    expect(SITE_METADATA.keywords).toEqual(
      expect.arrayContaining([
        'پت شاپ آنلاین',
        'خرید غذای گربه',
        'خرید غذای سگ',
        'Smokey Pet Shop',
      ]),
    );
    expect(SITE_METADATA.openGraph).toMatchObject({
      type: 'website',
      locale: 'fa_IR',
      images: [
        expect.objectContaining({
          url: '/brand/smokey-logo-primary.png',
          alt: expect.stringContaining('فروشگاه حیوانات خانگی'),
        }),
      ],
    });
    expect(SITE_METADATA.twitter).toMatchObject({
      card: 'summary',
      images: [
        expect.objectContaining({
          url: '/brand/smokey-logo-primary.png',
        }),
      ],
    });
  });

  it('allows the storefront while excluding private and machine routes', () => {
    expect(robots()).toEqual({
      rules: {
        userAgent: '*',
        allow: PATHS.HOME,
        disallow: [
          PROTECTED_PATHS.INDEX,
          API_ROOT,
          PATHS.ACCOUNT,
          PATHS.CHECKOUT,
          PATHS.LOGIN,
        ],
      },
      sitemap: `${DEFAULT_SITE_ORIGIN}/sitemap.xml`,
    });
  });
});
