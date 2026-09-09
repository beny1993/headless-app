import type { Metadata } from 'next';
import { DEFAULT_SITE_NAME, DEFAULT_SITE_ORIGIN } from '@/constants';

const SITE_TITLE = `${DEFAULT_SITE_NAME} | فروشگاه آنلاین حیوانات خانگی`;
const SITE_DESCRIPTION =
  'فروشگاه آنلاین اسموکی؛ خرید غذا، تشویقی، مکمل، لوازم بازی و بهداشت گربه و سگ در ایران.';
const SOCIAL_IMAGE = {
  url: '/brand/smokey-logo-primary.png',
  width: 1375,
  height: 1144,
  alt: 'لوگوی اسموکی، فروشگاه حیوانات خانگی',
};

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
    'Smokey Pet Shop',
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
  openGraph: {
    type: 'website',
    locale: 'fa_IR',
    siteName: DEFAULT_SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: 'summary',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [{ url: SOCIAL_IMAGE.url, alt: SOCIAL_IMAGE.alt }],
  },
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
