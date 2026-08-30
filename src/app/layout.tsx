import type { Metadata } from 'next';
import { DEFAULT_SITE_NAME } from '@/constants';
import { vazirmatn } from '@/lib/fonts';
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
  return (
    <html lang="fa" dir="rtl">
      <body className={`${vazirmatn.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
