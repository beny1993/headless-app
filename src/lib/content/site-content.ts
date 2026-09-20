// The storefront content contract — the key list and one `value` schema per key,
// shared by the admin form (which validates before it sends and maps
// `path: message` errors back onto its fields), the API route (which rejects a
// bad body with 400), and the DAO (which parses on write AND on read, resolving
// an invalid row to its default). Derive, never hand-mirror — this is the one
// place the shapes live.
//
// **Nothing here may import drizzle, `pg` or `@hono/zod-openapi`** — the editor is
// a client component, so this stays plain zod, exactly like `product-input.ts`.
// It leans on three already-client-safe modules: `boundedText` (the trimmed,
// length-capped, NUL-refusing string used across every input contract), the
// upload key shape, which `@/lib/storage/image-upload` owns — so the
// "what is a valid image key" rule is derived from the uploader, not restated —
// and `linkSchema` (`link.ts`), the one definition of a saved destination.
import { z } from 'zod';
import { blankableText, boundedText } from '@/lib/validation/text';
import { toAsciiDigits } from '@/lib/format';
import { imageKeySchema } from '@/lib/storage/image-upload';
import { LINK_MESSAGES, linkSchema } from './link';

/** One row per editable block. Fixed set — the structure lives in code, only the
 *  values move to the database. New blocks are a schema + a default + a code change.
 *
 *  Ordered by area, each area in page order (`CONTENT_AREAS` slices the same
 *  order), so a reader sees the storefront's own top-to-bottom shape here too.
 *
 *  **Compat rule for a shipped key (v3+):** adding a *required* field to a key
 *  that already has live rows makes every one of those rows fail parse — they
 *  fall back to the default (with a warn) until re-saved, silently losing the
 *  admin's edits. v2 could add `shopCta`, `cta`, `eyebrow`, … to v1 keys for free
 *  only because PR #26 never shipped and no row exists outside dev databases. Once
 *  a key is released, a new field needs a compat plan: `.optional()` with a
 *  code-side fallback, `.default()` when the fallback is one concrete value
 *  (`footer.social`), or a data migration script. */
export const CONTENT_KEYS = [
  // Home, in page order (matches `src/app/(app)/(store)/page.tsx`).
  'home.hero',
  'home.moments',
  'home.recommends',
  'home.journey',
  'home.guide',
  'home.routine',
  'home.family',
  'home.categories',
  'home.philosophy',
  // About, in page order.
  'about.hero',
  'about.story',
  'about.process',
  'about.values',
  'about.cta',
  // Checkout — the card-to-card payment block (cards, contact handles).
  'checkout.payment',
  // Site chrome — flat keys (no page order); each is its own area.
  'header',
  'footer',
] as const;

export const contentKeySchema = z.enum(CONTENT_KEYS);
export type ContentKey = z.infer<typeof contentKeySchema>;

/**
 * A storage object key, slash-less, rendered through `imageSrc(key)`. Exactly two
 * shapes, both anchored, so `..`, a leading `/`, an `http(s)://` URL, an unknown
 * prefix or a foreign extension all fail by construction — on write (the route's
 * 400) and on read (the DAO's fallback). A NUL cannot pass either: it matches
 * neither anchored character class.
 *   · a bundled asset:  `site/…` or `products/…` (today's defaults, served from public/)
 *   · an upload:        `uploads/<uuid>.<ext>` (the uploader's own key shape)
 */
// The key shape moved to `@/lib/storage/image-upload`, beside the constants it
// is derived from, so the product gallery validates against the same one
// rather than a second, looser answer. Re-exported because this module's own
// consumers and tests have always read it from here.
export { imageKeySchema };

// `t` is the trimmed, NUL-refusing, length-capped string; the ceilings are 2–4×
// today's longest value, generous room to edit without an unbounded field.
const t = boundedText;
const image = z.object({ key: imageKeySchema, alt: t(160) });
const slot = z.object({
  image: imageKeySchema,
  name: t(40),
  owner: t(40),
  quote: t(160),
});
const step = z.object({ step: t(40), desc: t(160) });
const item = z.object({ title: t(60), desc: t(200) });
// A saved destination (`link.ts`). Every key below has shipped, so a link field
// is optional AND nullable: absent or `null` means the destination the code had
// before links were editable (a `*_TARGETS` entry, a section's inline path), so a
// row saved before this change renders exactly as it did.
const link = linkSchema.nullish();
// Destinations zipped by index with a label tuple (header nav, footer column): a
// hole or `null` keeps that label's code destination, and the list is never
// longer than its labels.
const linkList = (labels: number) => z.array(link).max(labels).optional();
// A «خرید بر اساس لحظه» card: a label pair plus a photo. Its alt is derived
// (`alt=""`, decorative — the title sits next to it), so no alt field. Unset
// `link` → the same-index `LIFE_MOMENT_TARGETS` shop filters and emoji.
const card = z.object({
  title: t(60),
  desc: t(120),
  image: imageKeySchema,
  link,
});
// A «روتین روزانه» tab's two labels. Its emoji + category slugs are the same-index
// entry in `ROUTINE_TARGETS`; a saved `categoryIds` (1–4 distinct ids) replaces the
// slugs. The message is digit-free, like every Persian message here.
const ROUTINE_CATEGORIES_MESSAGE = 'یک تا چهار دسته‌بندی متفاوت انتخاب کن.';
/** A routine tab's category tiles at most; the editor's picker stops there too. */
export const MAX_ROUTINE_CATEGORIES = 4;
const routineSlot = z.object({
  label: t(30),
  sub: t(30),
  categoryIds: z
    .array(z.uuid(LINK_MESSAGES.category))
    .min(1, { error: ROUTINE_CATEGORIES_MESSAGE })
    .max(MAX_ROUTINE_CATEGORIES, { error: ROUTINE_CATEGORIES_MESSAGE })
    .refine((ids) => new Set(ids).size === ids.length, {
      error: ROUTINE_CATEGORIES_MESSAGE,
    })
    .optional(),
});
// The header's three nav labels; `navLinks` holds their destinations.
const nav = z.tuple([t(30), t(30), t(30)]);

// A bank card number a shopper transfers money TO — a money path, so it is
// normalized and checked on write and on read: Persian/Arabic digits → ASCII,
// spaces and dashes dropped, then exactly sixteen digits. `''` is an unused
// slot (kept as `''`, like every blank here, so a default, a stored row and the
// editor's empty field all parse to themselves). The message is digit-free,
// like every Persian message here.
const CARD_NUMBER_MESSAGE = 'شماره کارت باید شانزده رقم باشد.';
const cardNumber = z
  .string()
  .trim()
  .transform((v) => toAsciiDigits(v).replace(/[\s-]/g, ''))
  .refine((v) => v === '' || /^\d{16}$/.test(v), {
    error: CARD_NUMBER_MESSAGE,
  });
// A social username, stored bare. Admins paste what they have — `@name`, or
// the profile URL straight from the app, share token and all
// (`https://www.instagram.com/smokey.dailies?stkn=…`) — so a URL on one of the
// network's own hosts is reduced to its first path segment, and only the
// characters Instagram and Telegram allow may remain; the stored value never
// becomes `https://instagram.com/https://…` and never carries a tracking
// token. A URL from any other host is refused with its own message: a Telegram
// link in the Instagram field would otherwise silently link the wrong network.
// `''` means no link is rendered.
export const HANDLE_MESSAGES = {
  username:
    'نام کاربری فقط می‌تواند حروف انگلیسی، رقم، نقطه و خط زیر داشته باشد.',
  host: 'لینک باید آدرس پروفایل در همین شبکه باشد.',
} as const;
// `host/segment…`, with or without a scheme or `www.`; the host must be dotted,
// so `smokey/shop` is a bad username, not a URL.
const PROFILE_URL =
  /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/@?([^/?#\s]+)/i;
const handleOn = (hosts: readonly string[]) =>
  z
    .string()
    .trim()
    .transform((v) => {
      const url = PROFILE_URL.exec(v);
      if (url && hosts.includes(url[1].toLowerCase())) return url[2];
      return v.replace(/^@/, '');
    })
    .refine((v) => v === '' || /^[A-Za-z0-9._]{1,32}$/.test(v), {
      error: (issue) =>
        PROFILE_URL.test(String(issue.input))
          ? HANDLE_MESSAGES.host
          : HANDLE_MESSAGES.username,
    });
const instagramHandle = handleOn(['instagram.com']);
const telegramHandle = handleOn(['t.me', 'telegram.me']);
/** Where a stored handle links to — the one place each host is spelled. */
export const instagramUrl = (handle: string) =>
  `https://instagram.com/${handle}`;
export const telegramUrl = (handle: string) => `https://t.me/${handle}`;
/**
 * The footer's social pills as shipped: the shop's Instagram, the education-and-
 * fun Instagram («smokey.dailies») and the Telegram channel. Already in stored
 * form (bare, no `@`) — `.default()` short-circuits and never runs the handle
 * schema over it (a test proves it would pass). Lives here, not in `defaults.ts`, because
 * that module imports this one.
 */
export const FOOTER_SOCIAL_DEFAULT = {
  instagram: 'smokey.petshop',
  instagramDailies: 'smokey.dailies',
  telegram: 'smokeypetshop',
};
/** One card-to-card destination; a slot with an empty `number` is not shown. */
const bankCard = z.object({
  bank: blankableText(40),
  number: cardNumber,
  holder: blankableText(60),
});

// Per-block visibility. **Optional**, and read as "hidden only when explicitly
// false": absent (every default, every pre-existing row) or `true` renders the
// section, `false` makes the storefront skip it — so an admin can remove a
// section without a deploy, and nothing in the defaults or old rows changes.
// Kept out of the BLOCK_FIELDS descriptor list (a structural switch, not editable
// copy) and rendered as its own toggle, so the leaf/descriptor drift test — which
// tracks string leaves — is unaffected.
const visible = z.boolean().optional();

/**
 * The `value` schema per key. `z.tuple` is what makes "exactly six slots / four
 * steps, no add or remove" structural rather than a UI rule. Extra fields are
 * stripped, not stored. The family
 * slot's alt text is not a field: it stays derived in code (`${name}، حیوان
 * خانگی ${owner}`), as today.
 */
export const CONTENT_SCHEMAS = {
  'home.hero': z.object({
    eyebrow: t(60),
    headline: t(160),
    accent: t(60),
    body: t(600),
    image,
    // The two hero buttons' labels and destinations (unset: the shop, /about).
    shopCta: t(40),
    aboutCta: t(40),
    shopCtaLink: link,
    aboutCtaLink: link,
    visible,
  }),
  'home.moments': z.object({
    eyebrow: t(60),
    headline: t(120),
    // The «مشاهده همه» link label and destination (unset: the bare shop).
    cta: t(40),
    ctaLink: link,
    cards: z.tuple([card, card, card, card, card]),
    visible,
  }),
  'home.recommends': z.object({
    eyebrow: t(60),
    headline: t(120),
    body: t(200),
    visible,
  }),
  'home.journey': z.object({
    eyebrow: t(60),
    headline: t(120),
    body: t(200),
    visible,
  }),
  'home.guide': z.object({
    eyebrow: t(60),
    headline: t(160),
    body: t(1000),
    image,
    // The «مشاهده غذای مرطوب» link label and destination (unset: wet food).
    cta: t(40),
    ctaLink: link,
    visible,
  }),
  'home.routine': z.object({
    eyebrow: t(60),
    headline: t(120),
    body: t(200),
    slots: z.tuple([routineSlot, routineSlot, routineSlot, routineSlot]),
    visible,
  }),
  'home.family': z.object({
    eyebrow: t(60),
    headline: t(120),
    slots: z.tuple([slot, slot, slot, slot, slot, slot]),
    visible,
  }),
  'home.categories': z.object({
    headline: t(120),
    // The «همه دسته‌بندی‌ها» link label and destination (unset: the bare shop).
    cta: t(40),
    ctaLink: link,
    visible,
  }),
  'home.philosophy': z.object({
    eyebrow: t(60),
    headline: t(160),
    accent: t(60),
    body: t(600),
    // The «بیشتر درباره انتخاب محصولات» link label and destination (unset: /about).
    cta: t(40),
    ctaLink: link,
    visible,
  }),
  'about.hero': z.object({
    eyebrow: t(60),
    headline: t(160),
    accent: t(60),
    image,
    visible,
  }),
  'about.story': z.object({
    title: t(120),
    paragraphs: z.tuple([t(800), t(800), t(800)]),
    image,
    visible,
  }),
  'about.process': z.object({
    title: t(120),
    steps: z.tuple([step, step, step, step]),
    visible,
  }),
  'about.values': z.object({
    title: t(120),
    items: z.tuple([item, item, item, item]),
    visible,
  }),
  'about.cta': z.object({
    headline: t(120),
    // The closing button's label and destination (unset: the shop).
    cta: t(40),
    ctaLink: link,
    visible,
  }),
  // ── Checkout. No `visible`: the payment step always renders; the admin only
  // fills in where the money goes (up to three cards) and how to reach the shop.
  'checkout.payment': z.object({
    note: t(300),
    bankCards: z.tuple([bankCard, bankCard, bankCard]),
    instagram: instagramHandle,
    telegram: telegramHandle,
  }),
  // ── Site chrome. No `visible`: the header and footer are structural, always
  // rendered — the toggle is derived from the schema (`'visible' in shape`), so
  // its absence here is what hides it in the editor for these two blocks.
  header: z.object({
    // A display wordmark, independent of DEFAULT_SITE_NAME — editing it changes
    // the bar, never a page <title> or an email.
    brand: t(40),
    tagline: t(60),
    nav,
    navLinks: linkList(3),
  }),
  footer: z.object({
    brand: t(40),
    tagline: t(200),
    // Each column: a title, its link labels (5 and 1 today), and their
    // destinations by index (unset: the same-index `FOOTER_TARGETS[column]`).
    columns: z.tuple([
      z.object({
        title: t(40),
        links: z.tuple([t(30), t(30), t(30), t(30), t(30)]),
        linkTargets: linkList(5),
      }),
      z.object({
        title: t(40),
        links: z.tuple([t(30)]),
        linkTargets: linkList(1),
      }),
    ]),
    // The copyright sentence AFTER the `© {jalali year}` prefix — the prefix and
    // the year are rendered in code (`formatJalaliYear`), never stored.
    copyright: t(120),
    credit: t(120),
    // The brand column's social pills, each a bare handle; `''` hides that pill.
    // `.default()` is this shipped key's compat plan: a row saved before the
    // field existed parses to the real handles — on read, and in the editor,
    // which seeds from the parsed value, so an unrelated save round-trips them
    // instead of writing `''`. A saved `''` stays `''`: an admin can remove one.
    social: z
      .object({
        instagram: instagramHandle,
        instagramDailies: instagramHandle,
        telegram: telegramHandle,
      })
      .default(() => ({ ...FOOTER_SOCIAL_DEFAULT })),
  }),
} as const satisfies Record<ContentKey, z.ZodType>;

export type ContentValue<K extends ContentKey> = z.infer<
  (typeof CONTENT_SCHEMAS)[K]
>;
export type ContentValues = { [K in ContentKey]: ContentValue<K> };

/**
 * The editor's page organization: each area is one sidebar sub-link and one
 * `/admin-panel/content/[area]` page. `keys` are in page order, so the editor's
 * block order is the storefront's. The four `keys` arrays PARTITION `CONTENT_KEYS`
 * — every key in exactly one area (asserted in the test) — which is why the flat
 * `header`/`footer` keys need this table: an area cannot be derived from a key
 * prefix when two keys have none.
 */
export const CONTENT_AREAS = {
  home: {
    title: 'صفحه اصلی',
    keys: [
      'home.hero',
      'home.moments',
      'home.recommends',
      'home.journey',
      'home.guide',
      'home.routine',
      'home.family',
      'home.categories',
      'home.philosophy',
    ],
  },
  about: {
    title: 'درباره ما',
    keys: [
      'about.hero',
      'about.story',
      'about.process',
      'about.values',
      'about.cta',
    ],
  },
  checkout: { title: 'پرداخت', keys: ['checkout.payment'] },
  header: { title: 'هدر', keys: ['header'] },
  footer: { title: 'فوتر', keys: ['footer'] },
} as const satisfies Record<
  string,
  { title: string; keys: readonly ContentKey[] }
>;

export const contentAreaSchema = z.enum([
  'home',
  'about',
  'checkout',
  'header',
  'footer',
]);
export type ContentArea = z.infer<typeof contentAreaSchema>;

/**
 * Whether a content section renders. Read as "hidden only when explicitly
 * `false`": a section with `visible` absent (every default, every pre-existing
 * row) or `true` shows; only an explicit `false` hides it. The storefront pages
 * and the editor both call this instead of repeating `!== false` at each section.
 * Chrome blocks (`header`/`footer`) carry no `visible` field, so this returns
 * `true` for them — they are never conditionally rendered anyway.
 */
export function isVisible(block: { visible?: boolean }): boolean {
  return block.visible !== false;
}
