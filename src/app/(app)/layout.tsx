import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { DEFAULT_SITE_NAME } from '@/constants';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

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
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
