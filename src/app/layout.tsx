import type { Metadata } from 'next';
import Script from 'next/script';
import { DEFAULT_SITE_NAME } from '@/constants';
import { vazirmatn } from '@/lib/fonts';
import { getEnvVariable, VARS } from '@/lib/utils/env';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: DEFAULT_SITE_NAME,
    template: `%s | ${DEFAULT_SITE_NAME}`,
  },
  description: 'فروشگاه آنلاین لوازم و غذای حیوانات خانگی',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Self-hosted Umami. This is the ONE root layout — storefront and admin panel
  // both nest under it — so the tracker loads everywhere the `data-umami-event`
  // attributes already live, which includes `/admin-panel`. Both values are
  // inlined at BUILD time (STATIC_INLINED_VARS); either empty ⇒ nothing renders
  // and every one of those attributes stays inert.
  const umamiScriptUrl = getEnvVariable(
    VARS.NEXT_PUBLIC_UMAMI_SCRIPT_URL,
    false,
    '',
  ).trim();
  const umamiWebsiteId = getEnvVariable(
    VARS.NEXT_PUBLIC_UMAMI_WEBSITE_ID,
    false,
    '',
  ).trim();

  return (
    <html lang="fa" dir="rtl">
      <body className={`${vazirmatn.variable} font-sans antialiased`}>
        {children}
        {umamiScriptUrl && umamiWebsiteId ? (
          <Script src={umamiScriptUrl} data-website-id={umamiWebsiteId} />
        ) : null}
      </body>
    </html>
  );
}
