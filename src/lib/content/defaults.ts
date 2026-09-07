// Today's hardcoded storefront copy, moved here verbatim from
// `src/features/storefront/home/content.ts` and
// `src/features/storefront/about/about-sections.tsx`. These serve as BOTH the
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
  },
  'home.guide': {
    eyebrow: 'راهنمای اسموکی',
    headline: 'چرا بعضی گربه‌ها\nآب کافی نمی‌خورند؟',
    body: 'کم‌آبی در گربه‌ها یکی از مشکلات شایعی است که بسیاری از صاحبان نادیده می‌گیرند. غذای مرطوب ساده‌ترین راه جبران آن در وعده‌های روزانه است.',
    image: { key: 'site/cat-hygiene.jpg', alt: 'گربه‌ای کنار ظرف آب' },
  },
  'home.philosophy': {
    eyebrow: 'فلسفه اسموکی',
    headline: 'ما هر چیزی را',
    accent: 'نمی‌فروشیم.',
    body: 'محصولات اسموکی با تمرکز بر کیفیت، ترکیبات، کاربرد واقعی و تجربه‌ی حیوانات خانگی انتخاب می‌شوند.',
  },
  'home.family': {
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
  'about.cta': { headline: 'به خانواده اسموکی خوش اومدی.' },
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
