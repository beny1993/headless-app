import { Footer } from '@/features/storefront/layout/footer';
import { Navbar } from '@/features/storefront/layout/navbar';
import { readSiteChrome } from '@/lib/content/chrome';

// Async so the shared chrome (header + footer) reads its live content per request.
// `readSiteChrome` calls `await connection()` first, which marks the read
// request-time and keeps it out of the build's prerender — so `next build` never
// opens Postgres even though every storefront page now carries a DB-backed layout.
// The layout stays on `'auto'`; the request-time read is what makes its children
// dynamic (the build legend turns `/checkout/failed` from `○` to `ƒ`).
export default async function StorefrontLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const chrome = await readSiteChrome();

  return (
    <>
      <Navbar content={chrome.header} />
      {/* The navbar is fixed at h-16; this offset keeps page content clear
          of it without every page having to remember. */}
      <div className="flex min-h-screen flex-col pt-16">
        <div className="flex-1">{children}</div>
        <Footer content={chrome.footer} />
      </div>
    </>
  );
}
