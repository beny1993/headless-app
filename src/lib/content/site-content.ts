// The storefront content contract — the key list and one `value` schema per key,
// shared by the admin form (which validates before it sends and maps
// `path: message` errors back onto its fields), the API route (which rejects a
// bad body with 400), and the DAO (which parses on write AND on read, resolving
// an invalid row to its default). Derive, never hand-mirror — this is the one
// place the shapes live.
//
// **Nothing here may import drizzle, `pg` or `@hono/zod-openapi`** — the editor is
// a client component, so this stays plain zod, exactly like `product-input.ts`.
// It leans on two already-client-safe modules: `boundedText` (the trimmed,
// length-capped, NUL-refusing string used across every input contract) and the
// upload key shape (`UPLOAD_KEY_PREFIX` / `UPLOAD_FILENAME_PATTERN`) — so the
// "what is a valid image key" rule is derived from the uploader, not restated.
import { z } from 'zod';
import { boundedText } from '@/lib/validation/text';
import {
  UPLOAD_FILENAME_PATTERN,
  UPLOAD_KEY_PREFIX,
} from '@/lib/storage/image-upload';

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
 *  code-side fallback, or a data migration script. */
export const CONTENT_KEYS = [
  // Home, in page order (matches `src/app/(app)/page.tsx`).
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
const BUNDLED_IMAGE_KEY = /^(site|products)\/[a-z0-9-]+\.(jpe?g|png|webp)$/;

export const imageKeySchema = z
  .string()
  .max(200)
  .refine(
    (k) =>
      BUNDLED_IMAGE_KEY.test(k) ||
      (k.startsWith(`${UPLOAD_KEY_PREFIX}/`) &&
        UPLOAD_FILENAME_PATTERN.test(k.slice(UPLOAD_KEY_PREFIX.length + 1))),
    { message: 'کلید تصویر نامعتبر است.' },
  );

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
// A «خرید بر اساس لحظه» card: a label pair plus a photo. Its alt is derived
// (`alt=""`, decorative — the title sits next to it), so no alt field. The card's
// link target (emoji + shop filters) is a same-index entry in `LIFE_MOMENT_TARGETS`.
const card = z.object({ title: t(60), desc: t(120), image: imageKeySchema });
// A «روتین روزانه» tab's two labels. Its emoji + category slugs are the same-index
// entry in `ROUTINE_TARGETS`.
const routineSlot = z.object({ label: t(30), sub: t(30) });
// A footer column: a title and its link labels. The hrefs are the same-index
// `FOOTER_TARGETS[column]`; the two columns have 5 and 1 links today.
const nav = z.tuple([t(30), t(30), t(30)]);

// Per-block visibility. **Optional**, and read as "hidden only when explicitly
// false": absent (every default, every pre-existing row) or `true` renders the
// section, `false` makes the storefront skip it — so an admin can remove a
// section without a deploy, and nothing in the defaults or old rows changes.
// Kept out of the BLOCK_FIELDS descriptor list (a structural switch, not editable
// copy) and rendered as its own toggle, so the leaf/descriptor drift test — which
// tracks string leaves — is unaffected.
const visible = z.boolean().optional();

/**
 * The `value` schema per key. `z.tuple` is what makes "exactly five slots / four
 * steps, no add or remove" structural rather than a UI rule — a body with four or
 * six entries fails the schema. Extra fields are stripped, not stored. The family
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
    // The two hero buttons' labels; the targets (shop, /about) stay in code.
    shopCta: t(40),
    aboutCta: t(40),
    visible,
  }),
  'home.moments': z.object({
    eyebrow: t(60),
    headline: t(120),
    // The «مشاهده همه» link label; its target (the bare shop) stays in code.
    cta: t(40),
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
    // The «مشاهده غذای مرطوب» link label; its target (wet food) stays in code.
    cta: t(40),
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
    slots: z.tuple([slot, slot, slot, slot, slot]),
    visible,
  }),
  'home.categories': z.object({
    headline: t(120),
    // The «همه دسته‌بندی‌ها» link label; its target (the bare shop) stays in code.
    cta: t(40),
    visible,
  }),
  'home.philosophy': z.object({
    eyebrow: t(60),
    headline: t(160),
    accent: t(60),
    body: t(600),
    // The «بیشتر درباره انتخاب محصولات» link label; its target (/about) stays in code.
    cta: t(40),
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
    // The closing button's label; its target (the shop) stays in code.
    cta: t(40),
    visible,
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
  }),
  footer: z.object({
    brand: t(40),
    tagline: t(200),
    columns: z.tuple([
      z.object({
        title: t(40),
        links: z.tuple([t(30), t(30), t(30), t(30), t(30)]),
      }),
      z.object({ title: t(40), links: z.tuple([t(30)]) }),
    ]),
    // The copyright sentence AFTER the `© {jalali year}` prefix — the prefix and
    // the year are rendered in code (`formatJalaliYear`), never stored.
    copyright: t(120),
    credit: t(120),
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
  header: { title: 'هدر', keys: ['header'] },
  footer: { title: 'فوتر', keys: ['footer'] },
} as const satisfies Record<
  string,
  { title: string; keys: readonly ContentKey[] }
>;

export const contentAreaSchema = z.enum(['home', 'about', 'header', 'footer']);
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
