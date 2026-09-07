// Today's hardcoded storefront copy, moved here verbatim from the section
// components (`home/content.ts`, `home/*.tsx`, `about/about-sections.tsx`) and,
// in v2, the chrome (`layout/navbar.tsx`, `layout/footer.tsx`, `layout/nav-links.ts`).
// The link/card/tab *labels* moved here; their fixed *targets* (hrefs, shop
// filters, category slugs) stay in code as the `*_TARGETS` tuples the components
// zip with by index. These serve as BOTH the
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
import {
  CONTENT_SCHEMAS,
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
    image: { key: 'site/hero-home.jpg', alt: 'سگی آرام در فضای خانه' },
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
        image: 'products/cat-dry-food.jpg',
      },
      {
        title: 'وقت بازی',
        desc: 'سرگرمی هوشمند برای ذهن فعال',
        image: 'products/cat-toy.jpg',
      },
      {
        title: 'وقت تشویق',
        desc: 'پاداش کوچک برای رفتار خوب',
        image: 'products/dog-treats.jpg',
      },
      {
        title: 'مراقبت روزانه',
        desc: 'پوست، مو و بهداشت',
        image: 'products/cat-supplement.jpg',
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
    image: { key: 'site/cat-hygiene.jpg', alt: 'گربه‌ای کنار ظرف آب' },
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
        image: 'site/community-luna.jpg',
        name: 'لونا',
        owner: 'سارا',
        quote: 'لونا عاشق این تشویقیه.',
      },
      {
        image: 'products/dog-dry-food.jpg',
        name: 'آرکو',
        owner: 'علی',
        quote: 'هر روز صبح منتظر وعده‌اشه!',
      },
      {
        image: 'products/dog-treats.jpg',
        name: 'رکسی',
        owner: 'امیر',
        quote: 'سفر بدون رکسی معنی نداره.',
      },
      {
        image: 'site/community-baron.jpg',
        name: 'بارون',
        owner: 'کاوه',
        quote: 'بارون با این اسباب‌بازی ساعت‌ها بازی می‌کنه.',
      },
      {
        image: 'site/community-misha.jpg',
        name: 'میشا',
        owner: 'نیلوفر',
        quote: 'بهترین خواب دنیا رو داره.',
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
      key: 'site/hero-about.jpg',
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
      key: 'site/community-luna.jpg',
      alt: 'اسموکی، گربه‌ای سیاه‌وسفید با چشمان سبز',
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
  console.warn(
    `[content] site_content row "${key}" failed validation, using default: ${issues}`,
  );
  return DEFAULT_CONTENT[key];
}
