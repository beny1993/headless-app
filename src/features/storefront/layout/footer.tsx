import Link from 'next/link';
import { PATHS } from '@/lib/constant/paths';
import { formatJalaliYear } from '@/lib/format';

/**
 * Storefront footer, ported from the prototype.
 *
 * Trimmed to links with real destinations. The prototype's «پشتیبانی» column
 * (تماس با ما, راهنمای خرید, سوالات متداول, بازگشت کالا) and the «ارسال رایگان» /
 * «ضمانت کیفیت» entries have no pages and no stories behind them, so they would
 * ship as dead navigation — the one thing the design review is explicit about.
 * The grid drops from four columns to three as a result.
 *
 * The category links all point at the shop for now; [[Story - Shop Listing
 * Page]] defines the filter query-param contract and deep-links them.
 */
const FOOTER_COLUMNS = [
  {
    title: 'فروشگاه',
    links: [
      { label: 'گربه', href: PATHS.SHOP },
      { label: 'سگ', href: PATHS.SHOP },
      { label: 'غذا', href: PATHS.SHOP },
      { label: 'اسباب‌بازی', href: PATHS.SHOP },
      { label: 'مکمل', href: PATHS.SHOP },
    ],
  },
  {
    title: 'اسموکی',
    links: [{ label: 'درباره ما', href: PATHS.ABOUT }],
  },
] as const;

export function Footer() {
  return (
    <footer className="bg-ink text-white/70">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-8">
        <div className="mb-12 grid grid-cols-2 gap-8 md:grid-cols-3">
          <div className="col-span-2 md:col-span-1">
            <p className="mb-3 text-2xl font-black text-white">Smokey</p>
            <p className="text-sm leading-relaxed">
              فروشگاه تخصصی محصولات حیوانات خانگی. کیفیت اول، همیشه.
            </p>
          </div>
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="mb-4 font-bold text-white">{column.title}</p>
              <ul className="space-y-2">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="hover:text-accent-on-dark inline-block py-1 text-sm transition-colors"
                      data-umami-event="footer-link-click"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 sm:flex-row">
          <p className="text-sm">
            © {formatJalaliYear()} اسموکی. تمام حقوق محفوظ است.
          </p>
          <p className="text-xs">ساخته شده با ❤️ برای حیوانات خانگی ایران</p>
        </div>
      </div>
    </footer>
  );
}
