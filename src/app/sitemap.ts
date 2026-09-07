import type { MetadataRoute } from 'next';
import { DEFAULT_SITE_ORIGIN } from '@/constants';
import { PATHS } from '@/lib/constant/paths';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: new URL(PATHS.HOME, DEFAULT_SITE_ORIGIN).toString(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: new URL(PATHS.SHOP, DEFAULT_SITE_ORIGIN).toString(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: new URL(PATHS.ABOUT, DEFAULT_SITE_ORIGIN).toString(),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
  ];
}
