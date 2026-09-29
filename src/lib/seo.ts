// What the site tells search engines: the root `Metadata` every page starts
// from, the structured data (JSON-LD) Google reads a shop's name, prices and
// breadcrumbs from, and the sitemap. Every URL a search engine is handed — a
// canonical, a sitemap `<loc>`, a JSON-LD link — goes through `absoluteUrl`,
// so a page's canonical and its sitemap entry are the same string.
//
// Never give a layout `alternates.canonical`: every page without its own would
// inherit it and tell Google it is a copy of that one page.
import type { Metadata, MetadataRoute } from 'next';
import { DEFAULT_SITE_NAME, DEFAULT_SITE_ORIGIN } from '@/constants';
import { PATHS, productPath } from '@/lib/constant/paths';

/** What the shop is, in the words its title and generated copy share. */
export const SITE_TAGLINE = 'فروشگاه آنلاین حیوانات خانگی';

const SITE_TITLE = `${DEFAULT_SITE_NAME} | ${SITE_TAGLINE}`;
const SITE_DESCRIPTION =
  'فروشگاه آنلاین اسموکی؛ خرید غذا، تشویقی، مکمل، لوازم بازی و بهداشت گربه و سگ در ایران.';
const SOCIAL_IMAGE = {
  url: '/brand/smokey-logo-primary.png',
  width: 1375,
  height: 1144,
  alt: 'لوگوی اسموکی، فروشگاه حیوانات خانگی',
};

/** The brand's Latin name, which shoppers search for as well as the Persian. */
const LATIN_NAME = 'Smokey Pet Shop';

/**
 * The share cards every page starts from. No title or description: Next fills
 * a card's empty fields from the page's own, so a shelf or /about shared on
 * Telegram names itself (the home page's are the site's). Exported because
 * Next *replaces* a nested metadata object instead of merging it: a page that
 * sets its own `openGraph` or `twitter` spreads these back in, or loses the
 * site name, locale and image.
 */
export const SITE_OPEN_GRAPH = {
  type: 'website',
  locale: 'fa_IR',
  siteName: DEFAULT_SITE_NAME,
  images: [SOCIAL_IMAGE],
} satisfies Metadata['openGraph'];

export const SITE_TWITTER = {
  card: 'summary',
  images: [{ url: SOCIAL_IMAGE.url, alt: SOCIAL_IMAGE.alt }],
} satisfies Metadata['twitter'];

/** The generated meta description for a product or shelf with none of its own. */
export const purchaseSentence = (name: string): string =>
  `خرید ${name} از ${DEFAULT_SITE_NAME}، ${SITE_TAGLINE}.`;

export const SITE_METADATA: Metadata = {
  metadataBase: new URL(DEFAULT_SITE_ORIGIN),
  title: {
    default: SITE_TITLE,
    template: `%s | ${DEFAULT_SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: DEFAULT_SITE_NAME,
  creator: DEFAULT_SITE_NAME,
  publisher: DEFAULT_SITE_NAME,
  category: 'فروشگاه حیوانات خانگی',
  keywords: [
    'پت شاپ آنلاین',
    'فروشگاه حیوانات خانگی',
    'خرید غذای گربه',
    'خرید غذای سگ',
    'لوازم گربه',
    'لوازم سگ',
    'اسموکی',
    LATIN_NAME,
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  openGraph: SITE_OPEN_GRAPH,
  twitter: SITE_TWITTER,
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48' },
      { url: '/favicon-16x16.png', type: 'image/png', sizes: '16x16' },
      { url: '/favicon-32x32.png', type: 'image/png', sizes: '32x32' },
    ],
    apple: [
      {
        url: '/apple-touch-icon.png',
        type: 'image/png',
        sizes: '180x180',
      },
    ],
  },
};

/** `path` on the shop's own origin; an absolute URL (a bucket photo) is kept. */
export const absoluteUrl = (path: string): string =>
  new URL(path, DEFAULT_SITE_ORIGIN).toString();

/**
 * Integer Rial, for the one place Toman cannot go: structured data, where
 * Google needs an ISO 4217 currency and Toman has none (`priceCurrency: 'IRR'`).
 * Display only, **never a gateway amount**: Zarinpal takes Toman (`IRT`), and
 * `src/lib/zarinpal/client.ts` guards against exactly this 10× mix-up. Exact
 * for any price below 9×10¹⁴ Toman.
 */
export const rialForStructuredData = (toman: number): number => toman * 10;

/** One JSON-LD document; see https://schema.org. */
export type StructuredData = Record<string, unknown>;

/**
 * The body of a `<script type="application/ld+json">`. `<` is escaped, as in
 * the Next 16 JSON-LD guide, so admin-entered text (a title reading
 * `</script>…`) cannot close the tag; a JSON parser reads `\u003c` back as `<`.
 */
export const jsonLdHtml = (data: StructuredData): string =>
  JSON.stringify(data).replace(/</g, '\\u003c');

/** A page's trail as a schema.org `BreadcrumbList`, the crumbs it shows. */
export function breadcrumbJsonLd(
  trail: { name: string; path: string }[],
): StructuredData {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

/** Who runs the site, for the home page: the name and logo Google shows. */
export const SITE_JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: DEFAULT_SITE_NAME,
      alternateName: LATIN_NAME,
      url: absoluteUrl(PATHS.HOME),
      logo: absoluteUrl(SOCIAL_IMAGE.url),
    },
    {
      '@type': 'WebSite',
      name: DEFAULT_SITE_NAME,
      alternateName: LATIN_NAME,
      url: absoluteUrl(PATHS.HOME),
      inLanguage: 'fa-IR',
    },
  ],
} as const;

/**
 * `sitemap.xml` entries: the fixed pages, the shelves given (as paths) and the
 * product pages given. Which shelves and products that is, is the route's call
 * (`src/app/sitemap.ts`). A product is dated by its last change; nothing else
 * has a date, since Google trusts `<lastmod>` only while it is accurate.
 */
export function sitemapEntries(
  products: { slug: string; updatedAt: Date }[],
  shelves: string[],
): MetadataRoute.Sitemap {
  return [
    { url: absoluteUrl(PATHS.HOME), changeFrequency: 'daily', priority: 1 },
    { url: absoluteUrl(PATHS.SHOP), changeFrequency: 'daily', priority: 0.9 },
    ...shelves.map((path) => ({
      url: absoluteUrl(path),
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
    ...products.map((product) => ({
      url: absoluteUrl(productPath(product.slug)),
      lastModified: product.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    {
      url: absoluteUrl(PATHS.ABOUT),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
  ];
}
