import { Footer } from '@/features/storefront/layout/footer';
import { Navbar } from '@/features/storefront/layout/navbar';

export default function StorefrontLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <Navbar />
      {/* The navbar is fixed at h-16; this offset keeps page content clear
          of it without every page having to remember. */}
      <div className="flex min-h-screen flex-col pt-16">
        <div className="flex-1">{children}</div>
        <Footer />
      </div>
    </>
  );
}
