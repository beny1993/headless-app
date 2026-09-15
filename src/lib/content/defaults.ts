// Today's hardcoded storefront copy, moved here verbatim from the section
// components (`home/content.ts`, `home/*.tsx`, `about/about-sections.tsx`) and,
// in v2, the chrome (`layout/navbar.tsx`, `layout/footer.tsx`, `layout/nav-links.ts`).
// The link/card/tab *labels* moved here; their code *targets* (hrefs, shop
// filters, category slugs) stay in code as the `*_TARGETS` tuples the components
// zip with by index — the fallback wherever no destination is saved, which is
// every default (none carries a link field). These serve as BOTH the
// implicit seed and the fallback: with an empty `site_content` table every page
// renders byte-identical to before this story, and no SQL migration carries a
// second, driftable copy of the Persian copy.
//
// Two shapes change from the source, by the story's own security AC — content
// cannot carry markup, so a headline's `<br />` becomes a `\n` rendered by CSS
// `white-space: pre-line`, and a paragraph that spanned several source lines is
// one string (JSX collapsed those breaks to a single space anyway). "Byte-
// identical" is therefore: these strings equal today's (the unit tests here and
// in the storefront), and the rendered text equals today's (the page integration
// tests); pixels are confirmed at QA.
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
    eyebrow: 'زندگی با اسموکی',
    headline: 'زندگی بهتر،\nکنار بهترین',
    accent: 'دوستت',
    body: 'محصولاتی که با دقت برای سلامت، شادی و زندگی روزمره‌ی گربه‌ها و سگ‌ها انتخاب شده‌اند.',
    image: {
      key: 'site/smokey-hero-v4.jpg',
      alt: 'اسموکی، گربه خاکستری اسکاتیش فولد در فضای خانه',
    },
    shopCta: 'کشف محصولات',
    aboutCta: 'داستان اسموکی',
  },
  'home.moments': {
    eyebrow: 'خرید بر اساس لحظه',
    headline: 'زندگی با حیوانات خانگی',
    cta: 'مشاهده همه',
    // Card photos are slash-less storage keys now (the family precedent); the
    // emoji + shop filters live in LIFE_MOMENT_TARGETS at the same index.
    cards: [
      {
        title: 'وقت غذا',
        desc: 'بهترین تغذیه برای سلامت روزانه',
        image: 'site/sansa.webp',
      },
      {
        title: 'وقت بازی',
        desc: 'سرگرمی هوشمند برای ذهن فعال',
        image: 'site/khepelo.webp',
      },
      {
        title: 'وقت تشویق',
        desc: 'پاداش کوچک برای رفتار خوب',
        image: 'products/dog-treats.jpg',
      },
      {
        title: 'مراقبت روزانه',
        desc: 'پوست، مو و بهداشت',
        image: 'site/melis.webp',
      },
      {
        title: 'وعده‌ی سگ',
        desc: 'انرژی روزانه برای یک سگ فعال',
        image: 'products/dog-dry-food.jpg',
      },
    ],
  },
  'home.recommends': {
    eyebrow: 'کیوریت شده با دقت',
    headline: 'انتخاب‌های اسموکی',
    body: 'محصولاتی که اسموکی شخصاً تجربه کرده و توصیه می‌کند',
  },
  'home.journey': {
    eyebrow: 'خرید شخصی‌سازی شده',
    headline: 'برای کی خرید می‌کنی؟',
    body: 'چند سوال کوتاه تا بهترین محصولات رو بهت پیشنهاد بدیم',
  },
  'home.guide': {
    eyebrow: 'راهنمای اسموکی',
    headline: 'چرا بعضی گربه‌ها\nآب کافی نمی‌خورند؟',
    body: 'کم‌آبی در گربه‌ها یکی از مشکلات شایعی است که بسیاری از صاحبان نادیده می‌گیرند. غذای مرطوب ساده‌ترین راه جبران آن در وعده‌های روزانه است.',
    image: {
      key: 'site/fiuna.webp',
      alt: 'فیونا، گربه اسکاتیش فولد با چشم‌های زردسبز',
    },
    cta: 'مشاهده غذای مرطوب',
  },
  'home.routine': {
    eyebrow: 'روتین روزانه',
    headline: 'روتین روزانه یک گربه خوشحال',
    body: 'دسته‌بندی‌های پیشنهادی برای این مرحله',
    // Emoji + category slugs are in ROUTINE_TARGETS at the same index.
    slots: [
      { label: 'صبح', sub: 'غذا' },
      { label: 'ظهر', sub: 'بازی' },
      { label: 'عصر', sub: 'مراقبت' },
      { label: 'شب', sub: 'آرامش' },
    ],
  },
  'home.family': {
    eyebrow: 'داستان‌های واقعی',
    headline: 'خانواده اسموکی',
    slots: [
      {
        image: 'site/smokey-v2.webp',
        name: 'اسموکی',
        owner: 'خانواده اسموکی',
        quote: 'همه‌چیز از عشق به اسموکی شروع شد.',
      },
      {
        image: 'site/sansa.webp',
        name: 'سانسا',
        owner: 'خانواده اسموکی',
        quote: 'سانسا دنیا را از کنار پنجره تماشا می‌کند.',
      },
      {
        image: 'site/khepelo.webp',
        name: 'خپلو',
        owner: 'خانواده اسموکی',
        quote: 'خپلو همیشه با کنجکاوی همه‌جا را کشف می‌کند.',
      },
      {
        image: 'site/fiuna.webp',
        name: 'فیونا',
        owner: 'خانواده اسموکی',
        quote: 'نگاه فیونا هر روز خانه را شیرین‌تر می‌کند.',
      },
      {
        image: 'site/melis.webp',
        name: 'ملیس',
        owner: 'خانواده اسموکی',
        quote: 'ملیس آرام‌ترین گوشه خانه را همیشه پیدا می‌کند.',
      },
      {
        image: 'site/lili.webp',
        name: 'لیلی',
        owner: 'خانواده اسموکی',
        quote: 'لیلی عاشق تماشای خانه از روی میز است.',
      },
    ],
  },
  'home.categories': {
    headline: 'فروشگاه',
    cta: 'همه دسته‌بندی‌ها',
  },
  'home.philosophy': {
    eyebrow: 'فلسفه اسموکی',
    headline: 'ما هر چیزی را',
    accent: 'نمی‌فروشیم.',
    body: 'محصولات اسموکی با تمرکز بر کیفیت، ترکیبات، کاربرد واقعی و تجربه‌ی حیوانات خانگی انتخاب می‌شوند.',
    cta: 'بیشتر درباره انتخاب محصولات',
  },
  'about.hero': {
    eyebrow: 'داستان ما',
    headline: 'همه‌چیز از عشق\nبه یک گربه',
    accent: 'شروع شد.',
    image: {
      key: 'site/smokey-hero.webp',
      alt: 'اسموکی، گربه‌ای که فروشگاه از او شروع شد',
    },
  },
  'about.story': {
    title: 'این اسموکی‌ه',
    paragraphs: [
      'وقتی اسموکی وارد زندگی‌مان شد، متوجه شدیم که پیدا کردن محصولات واقعاً مناسب چقدر سخت است. بازار پر از گزینه‌هاست اما اطلاعات درست کمیاب.',
      'اسموکی فروشگاه از همین سوال ساده متولد شد: «چه محصولی واقعاً برای حیوان خانگی من خوب است؟»',
      'امروز هر محصولی که پیشنهاد می‌دهیم، از فیلتر دقیق کیفیت، ترکیبات، و تجربه واقعی گذشته.',
    ],
    image: {
      key: 'site/smokey-v2.webp',
      alt: 'اسموکی، گربه خاکستری اسکاتیش فولد با چشمان سبز',
    },
  },
  'about.process': {
    title: 'فرآیند انتخاب محصولات',
    steps: [
      { step: 'بررسی', desc: 'تحقیق عمیق روی ترکیبات و برند' },
      { step: 'انتخاب', desc: 'انتخاب بهترین‌ها از بین صدها محصول' },
      { step: 'تجربه', desc: 'تست واقعی توسط تیم و مشتریان' },
      { step: 'پیشنهاد', desc: 'ارائه با اطمینان کامل' },
    ],
  },
  'about.values': {
    title: 'ارزش‌های ما',
    items: [
      {
        title: 'کیفیت قبل از تعداد',
        desc: 'ترجیح می‌دهیم کمتر بفروشیم اما بهترین را بفروشیم.',
      },
      {
        title: 'صداقت در پیشنهاد',
        desc: 'فقط چیزی پیشنهاد می‌دهیم که خودمان به آن ایمان داریم.',
      },
      {
        title: 'احترام به حیوانات',
        desc: 'رفاه حیوانات در تمام تصمیمات ما اولویت دارد.',
      },
      {
        title: 'تجربه واقعی',
        desc: 'محصولاتمان را واقعاً تست می‌کنیم، نه فقط مطالعه.',
      },
    ],
  },
  'about.cta': { headline: 'به خانواده اسموکی خوش اومدی.', cta: 'کشف محصولات' },
  // Ships with the shop's card in slot 1 (already in the schema's stored form:
  // sixteen ASCII digits) and the shop's own handles — the receipt inbox is the
  // shop account, never the education one; `''` is an unused slot, the same in
  // the default, a stored row and the editor. The storefront shows only filled
  // slots. A row saved before the handles were known keeps its own `''`: on
  // staging the admin fills the two fields once.
  'checkout.payment': {
    note: 'مبلغ سفارش را به یکی از کارت‌های زیر واریز کن و رسید را برای ما بفرست. سفارش پس از تأیید واریز ارسال می‌شود.',
    bankCards: [
      { bank: '', number: '6129861927666866', holder: '' },
      { bank: '', number: '', holder: '' },
      { bank: '', number: '', holder: '' },
    ],
    instagram: FOOTER_SOCIAL_DEFAULT.instagram,
    telegram: FOOTER_SOCIAL_DEFAULT.telegram,
  },
  header: {
    // A display wordmark, independent of DEFAULT_SITE_NAME (which is «اسموکی» and
    // drives page <title>s and emails) — today's latin bar wordmark, verbatim.
    brand: 'Smokey',
    tagline: 'فروشگاه حیوانات',
    // Labels only; the hrefs are NAV_TARGETS in nav-links.ts at the same index.
    nav: ['خانه', 'فروشگاه', 'درباره ما'],
  },
  footer: {
    brand: 'Smokey',
    tagline: 'فروشگاه تخصصی محصولات حیوانات خانگی. کیفیت اول، همیشه.',
    // Column titles + link labels; the hrefs are FOOTER_TARGETS at the same index.
    columns: [
      { title: 'فروشگاه', links: ['گربه', 'سگ', 'غذا', 'اسباب‌بازی', 'مکمل'] },
      { title: 'اسموکی', links: ['درباره ما'] },
    ],
    // The text AFTER the `© {jalali year}` prefix (rendered in code), verbatim.
    copyright: 'اسموکی. تمام حقوق محفوظ است.',
    credit: 'ساخته شده با ❤️ برای حیوانات خانگی ایران',
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
