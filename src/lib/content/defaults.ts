// The storefront's default copy: neutral demo text for a shop that has not
// written its own yet, for the sections (`home/*.tsx`, `about/about-sections.tsx`)
// and the chrome (`layout/navbar.tsx`, `layout/footer.tsx`, `layout/nav-links.ts`).
// The link labels live here; their code *targets* (hrefs, category slugs) stay
// in code as the `*_TARGETS` tuples the components zip with by index — the
// fallback wherever no destination is saved, which is every default (none
// carries a link field). These serve as BOTH the implicit seed and the
// fallback: an empty `site_content` table renders this copy, and no SQL
// migration carries a second, driftable copy of it.
//
// Content cannot carry markup, so a headline's line break is a `\n` rendered by
// CSS `white-space: pre-line`.
//
// **Client-safe, like `site-content.ts`** — no drizzle / `pg` / hono import, so a
// mis-formatted `console.warn` cannot drag a server-only dependency anywhere.
import * as Sentry from '@sentry/nextjs';
import {
  CONTENT_SCHEMAS,
  FOOTER_SOCIAL_DEFAULT,
  type ContentKey,
  type ContentValue,
  type ContentValues,
} from './site-content';

// Annotated, not `satisfies … as const`: `as const` would make the tuple fields
// readonly, but `z.infer` of a `z.tuple` is a mutable tuple, so a readonly
// literal would not be assignable. The annotation gives the same contextual
// typing (each tuple sized and shaped) with the exact `ContentValues` type the
// generic index in `resolveContent` needs.
export const DEFAULT_CONTENT: ContentValues = {
  'home.hero': {
    eyebrow: 'به فروشگاه ما خوش آمدی',
    headline: 'چیزهای خوب،\nبرای هر روز',
    accent: 'زندگی',
    body: 'محصولاتی که با دقت انتخاب شده‌اند تا کار روزمره را ساده‌تر و خانه را دلنشین‌تر کنند.',
    image: {
      key: 'site/hero-shop.jpg',
      alt: 'چند محصول رنگی کنار هم روی یک قفسه',
    },
    shopCta: 'مشاهده محصولات',
    aboutCta: 'درباره ما',
  },
  'home.recommends': {
    eyebrow: 'انتخاب‌شده با دقت',
    headline: 'پیشنهادهای ما',
    body: 'محصولاتی که بیشتر از همه دوستشان داریم',
  },
  'home.guide': {
    eyebrow: 'راهنمای خرید',
    headline: 'خانه‌ای گرم‌تر\nبا چند تغییر کوچک',
    body: 'نور مناسب، یک شمع خوش‌بو و چند وسیله‌ی خوش‌رنگ می‌توانند حال و هوای خانه را عوض کنند. چند پیشنهاد ساده برای شروع آماده کرده‌ایم.',
    image: {
      key: 'site/editorial.jpg',
      alt: 'تصویر تزئینی یک دفترچه',
    },
    cta: 'مشاهده دکوراسیون',
  },
  'home.categories': {
    headline: 'دسته‌بندی‌ها',
    cta: 'همه دسته‌بندی‌ها',
  },
  'home.philosophy': {
    eyebrow: 'روش ما',
    headline: 'هر چیزی را',
    accent: 'نمی‌فروشیم.',
    body: 'هر محصول پیش از رسیدن به فروشگاه از نظر کیفیت، کاربرد و دوام بررسی می‌شود.',
    cta: 'بیشتر درباره ما',
  },
  'about.hero': {
    eyebrow: 'داستان ما',
    headline: 'فروشگاهی کوچک\nبا دقتی بزرگ',
    accent: 'برای تو.',
    image: {
      key: 'site/about-hero.jpg',
      alt: 'تصویر تزئینی یک ویترین فروشگاه',
    },
  },
  'about.story': {
    title: 'ما که هستیم',
    paragraphs: [
      'این فروشگاه با یک ایده‌ی ساده شروع شد: پیدا کردن محصول خوب نباید سخت باشد.',
      'به جای فهرستی بی‌پایان، مجموعه‌ای کوچک و انتخاب‌شده عرضه می‌کنیم که پشت هر کدامش می‌ایستیم.',
      'سفارش را با دقت بسته‌بندی می‌کنیم و تا رسیدن به دستت پیگیرش هستیم.',
    ],
    image: {
      key: 'site/editorial.jpg',
      alt: 'تصویر تزئینی یک دفترچه',
    },
  },
  'about.process': {
    title: 'چطور انتخاب می‌کنیم',
    steps: [
      { step: 'بررسی', desc: 'جست‌وجو میان برندها و سازنده‌ها' },
      { step: 'انتخاب', desc: 'برگزیدن بهترین‌ها از میان گزینه‌ها' },
      { step: 'آزمایش', desc: 'استفاده‌ی واقعی پیش از عرضه' },
      { step: 'پیشنهاد', desc: 'عرضه با اطمینان کامل' },
    ],
  },
  'about.values': {
    title: 'ارزش‌های ما',
    items: [
      {
        title: 'کیفیت پیش از تعداد',
        desc: 'ترجیح می‌دهیم کمتر بفروشیم اما بهترین را بفروشیم.',
      },
      {
        title: 'صداقت در پیشنهاد',
        desc: 'فقط چیزی را پیشنهاد می‌دهیم که خودمان به آن باور داریم.',
      },
      {
        title: 'احترام به مشتری',
        desc: 'پاسخ‌گویی سریع و روشن، پیش و پس از خرید.',
      },
      {
        title: 'تجربه‌ی واقعی',
        desc: 'محصولات را واقعاً امتحان می‌کنیم، نه فقط درباره‌شان می‌خوانیم.',
      },
    ],
  },
  'about.cta': { headline: 'خوشحالیم که اینجایی.', cta: 'مشاهده محصولات' },
  // Ships with every card slot empty: a shop fills in its own card numbers and
  // handles in the admin panel. `''` is an unused slot, the same in the
  // default, a stored row and the editor; the storefront shows only filled
  // slots and hides an empty handle.
  'checkout.payment': {
    note: 'مبلغ سفارش را به یکی از کارت‌های زیر واریز کن و اسکرین‌شات رسید را همین‌جا پیوست کن. سفارش پس از بررسی رسید ارسال می‌شود.',
    bankCards: [
      { bank: '', number: '', holder: '' },
      { bank: '', number: '', holder: '' },
      { bank: '', number: '', holder: '' },
    ],
    instagram: FOOTER_SOCIAL_DEFAULT.instagram,
    telegram: FOOTER_SOCIAL_DEFAULT.telegram,
  },
  header: {
    // A display wordmark, independent of DEFAULT_SITE_NAME (which drives page
    // <title>s and emails).
    brand: 'Demo Shop',
    tagline: 'فروشگاه نمونه',
    // Labels only; the hrefs are NAV_TARGETS in nav-links.ts at the same index.
    nav: ['خانه', 'فروشگاه', 'درباره ما'],
  },
  footer: {
    brand: 'Demo Shop',
    tagline: 'فروشگاه آنلاین با محصولات انتخاب‌شده. کیفیت اول، همیشه.',
    // Column titles + link labels; the hrefs are FOOTER_TARGETS at the same index.
    columns: [
      {
        title: 'فروشگاه',
        links: ['آشپزخانه', 'نوشت‌افزار', 'دکوراسیون', 'کیف و سفر', 'سرگرمی'],
      },
      { title: 'فروشگاه نمونه', links: ['درباره ما'] },
    ],
    // The text AFTER the `© {jalali year}` prefix (rendered in code).
    copyright: 'فروشگاه نمونه. تمام حقوق محفوظ است.',
    credit: 'ساخته شده با ❤️ در ایران',
    social: { ...FOOTER_SOCIAL_DEFAULT },
  },
};

/**
 * Resolve a raw DB `value` (or `undefined` for a missing row) to a valid,
 * fully-typed block value:
 *   · missing (`undefined`)      → the default, silently (an empty table is not an error)
 *   · fails the key's schema     → the default, plus ONE `console.warn` naming the
 *                                  key and the issues (a row edited outside the app,
 *                                  a bad image key, a wrong tuple length)
 *   · valid                      → the parsed value (extra fields stripped)
 *
 * Pure — no Postgres — so it is unit-tested directly. It does NOT swallow a
 * *missing database*: that is the caller's read throwing, and the page 500s the
 * way `/` already does, rather than masking a broken environment behind default copy.
 */
export function resolveContent<K extends ContentKey>(
  key: K,
  raw: unknown,
): ContentValue<K> {
  if (raw === undefined) return DEFAULT_CONTENT[key];

  const parsed = (
    CONTENT_SCHEMAS[key] as (typeof CONTENT_SCHEMAS)[K]
  ).safeParse(raw);
  if (parsed.success) return parsed.data as ContentValue<K>;

  const issues = parsed.error.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
  const message = `[content] site_content row "${key}" failed validation, using default: ${issues}`;
  console.warn(message);
  // The page still renders (that is the whole point of the fallback), so nobody
  // finds out from the site that an admin's edit is being ignored.
  Sentry.captureMessage(message, 'warning');
  return DEFAULT_CONTENT[key];
}
