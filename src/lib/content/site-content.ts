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
 *  values move to the database. New blocks are a schema + a default + a code change. */
export const CONTENT_KEYS = [
  'home.hero',
  'home.guide',
  'home.philosophy',
  'home.family',
  'about.hero',
  'about.story',
  'about.process',
  'about.values',
  'about.cta',
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
  }),
  'home.guide': z.object({
    eyebrow: t(60),
    headline: t(160),
    body: t(1000),
    image,
  }),
  'home.philosophy': z.object({
    eyebrow: t(60),
    headline: t(160),
    accent: t(60),
    body: t(600),
  }),
  'home.family': z.object({ slots: z.tuple([slot, slot, slot, slot, slot]) }),
  'about.hero': z.object({
    eyebrow: t(60),
    headline: t(160),
    accent: t(60),
    image,
  }),
  'about.story': z.object({
    title: t(120),
    paragraphs: z.tuple([t(800), t(800), t(800)]),
    image,
  }),
  'about.process': z.object({
    title: t(120),
    steps: z.tuple([step, step, step, step]),
  }),
  'about.values': z.object({
    title: t(120),
    items: z.tuple([item, item, item, item]),
  }),
  'about.cta': z.object({ headline: t(120) }),
} as const satisfies Record<ContentKey, z.ZodType>;

export type ContentValue<K extends ContentKey> = z.infer<
  (typeof CONTENT_SCHEMAS)[K]
>;
export type ContentValues = { [K in ContentKey]: ContentValue<K> };
