import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/sonner';
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
  // One toast region for the whole panel. It lives in this layout rather than a
  // page, so a toast raised just before a client navigation (the product form's
  // "saved, but the photo did not upload") survives onto the next page.
  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
