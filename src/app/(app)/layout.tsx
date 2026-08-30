import type { Metadata } from 'next';
import { DEFAULT_SITE_NAME } from '@/constants';
import { Footer } from '@/features/storefront/layout/footer';
import { Navbar } from '@/features/storefront/layout/navbar';
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
        <Navbar />
        {/* The navbar is fixed at h-16; this offset keeps page content clear
            of it without every page having to remember. */}
        <div className="flex min-h-screen flex-col pt-16">
          <div className="flex-1">{children}</div>
          <Footer />
        </div>
      </body>
    </html>
  );
}
