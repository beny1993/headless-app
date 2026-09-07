import type { Metadata } from 'next';
import { vazirmatn } from '@/lib/fonts';
import { SITE_METADATA } from '@/lib/seo';
import './globals.css';

export const metadata: Metadata = SITE_METADATA;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl">
      <body className={`${vazirmatn.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
