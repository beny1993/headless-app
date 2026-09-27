import { Suspense } from 'react';
import type { Metadata } from 'next';
import { UmamiTracker } from '@/components/umami-tracker';
import { vazirmatn } from '@/lib/fonts';
import { SITE_METADATA } from '@/lib/seo';
import { getEnvVariable, VARS } from '@/lib/utils/env';
import './globals.css';

export const metadata: Metadata = SITE_METADATA;

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
          // Suspense: `useSearchParams` outside one fails `next build` for any
          // static page — and only the production image sets these vars.
          <Suspense fallback={null}>
            <UmamiTracker src={umamiScriptUrl} websiteId={umamiWebsiteId} />
          </Suspense>
        ) : null}
      </body>
    </html>
  );
}
