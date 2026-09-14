import { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/features/storefront/layout/footer';
import { Navbar } from '@/features/storefront/layout/navbar';
import { PATHS } from '@/lib/constant/paths';
import { readSiteChrome } from '@/lib/content/chrome';

export const metadata: Metadata = {
  title: 'صفحه پیدا نشد',
  description: 'صفحه‌ای که دنبال آن هستید وجود ندارد یا جابه‌جا شده است.',
};

/* Unmatched URLs render outside every route group, so this page brings the
   storefront chrome itself — components, never a group layout (that layout
   owns nothing above <body> anymore, but importing layouts here re-creates
   the nested-document bug this file once had).

   Async so the chrome shows the admin's live header/footer on a 404 too — the
   same `readSiteChrome` the (app) layout uses. It sits outside every route group
   and takes no segment config, so `connection()` inside that helper is the only
   live-read tool here; the build legend turns `/_not-found` from `○` to `ƒ`. */
export default async function NotFound() {
  const chrome = await readSiteChrome();

  return (
    <>
      <Navbar content={chrome.header} targets={chrome.targets} />
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 pt-16 text-center">
        <p className="text-muted-foreground text-sm font-medium">۴۰۴</p>
        <h1 className="text-2xl font-semibold">صفحه پیدا نشد</h1>
        <p className="text-muted-foreground text-sm">
          صفحه‌ای که دنبال آن هستید وجود ندارد یا جابه‌جا شده است.
        </p>
        <Link
          href={PATHS.HOME}
          className="text-sm font-medium underline underline-offset-4"
          data-umami-event="not-found-home-link"
        >
          بازگشت به خانه
        </Link>
      </main>
      <Footer content={chrome.footer} targets={chrome.targets} />
    </>
  );
}
