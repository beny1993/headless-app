import type { MetadataRoute } from 'next';
import { DEFAULT_SITE_ORIGIN } from '@/constants';
import { API_ROOT, PATHS, PROTECTED_PATHS } from '@/lib/constant/paths';

export default function robots(): MetadataRoute.Robots {
  return {
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
  };
}
