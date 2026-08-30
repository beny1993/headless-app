import type { Metadata } from 'next';
import { DEFAULT_SITE_NAME } from '@/constants';
import '../(app)/globals.css';

export const metadata: Metadata = {
  title: {
    default: `Back office | ${DEFAULT_SITE_NAME}`,
    template: `%s | ${DEFAULT_SITE_NAME}`,
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
