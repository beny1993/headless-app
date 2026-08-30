import type { Metadata } from 'next';
import { DEFAULT_SITE_NAME } from '@/constants';

export const metadata: Metadata = {
  title: {
    default: `Admin panel | ${DEFAULT_SITE_NAME}`,
    template: `%s | ${DEFAULT_SITE_NAME}`,
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminPanelLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
