import Link from 'next/link';
import { PATHS } from '@/lib/constant/paths';

/**
 * Three different nothings, and each one has its own way out.
 *
 * A page number past the end of the catalog is a URL problem, and the way out
 * is page one. A search that matched nothing is about the *term* — the shopper
 * needs to see which words were searched for, because a typo is the usual
 * cause, and the way out is dropping the term while keeping the filters they
 * chose deliberately. A filter set that matches nothing is the design's
 * original empty state, cleared by going back to the plain shop.
 */
export function ShopEmptyState({
  pastLastPage,
  searchTerm,
  firstPageHref,
  clearSearchHref,
}: {
  pastLastPage: boolean;
  /** The term that matched nothing, or undefined when this is not a search. */
  searchTerm?: string;
  firstPageHref: string;
  clearSearchHref: string;
}) {
  const searchMissed = !pastLastPage && searchTerm !== undefined;

  return (
    <div className="bg-secondary/30 flex flex-col items-center justify-center gap-3 rounded-3xl py-24 text-center">
      <span className="text-5xl" aria-hidden="true">
        🔍
      </span>
      <p className="text-lg font-bold">
        {pastLastPage
          ? 'این صفحه محصولی ندارد'
          : searchMissed
            ? // The term is quoted so the shopper can see exactly what was
              // searched for — «چیزی پیدا نشد» alone hides the typo that caused
              // it. Persian quotation marks, as everywhere else on the site.
              `نتیجه‌ای برای «${searchTerm}» پیدا نشد`
            : 'محصولی با این فیلترها پیدا نشد'}
      </p>
      <p className="text-muted-foreground max-w-sm text-sm">
        {pastLastPage
          ? 'شماره صفحه از آخرین صفحه بیشتر است.'
          : searchMissed
            ? 'املای عبارت را بررسی کن یا کلمه کوتاه‌تری را امتحان کن.'
            : 'می‌توانی فیلترها را کم کنی و دوباره امتحان کنی.'}
      </p>
      <Link
        href={
          pastLastPage
            ? firstPageHref
            : searchMissed
              ? clearSearchHref
              : PATHS.SHOP
        }
        className="bg-brand hover:bg-brand-hover text-brand-foreground mt-2 rounded-xl px-6 py-3 font-bold transition-colors"
        data-umami-event={
          pastLastPage
            ? 'shop-empty-first-page'
            : searchMissed
              ? 'shop-empty-clear-search'
              : 'shop-empty-clear-filters'
        }
      >
        {pastLastPage
          ? 'بازگشت به صفحه اول'
          : searchMissed
            ? 'پاک کردن جستجو'
            : 'پاک کردن همه فیلترها'}
      </Link>
    </div>
  );
}
