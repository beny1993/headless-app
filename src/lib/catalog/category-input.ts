// The create/edit-category body contract — one zod schema shared by the admin
// category routes (which reject a bad body with 400) and the admin category
// manager (which validates before it sends and maps `path: message` errors back
// onto its fields). Derive, never hand-mirror.
//
// **Nothing here may import drizzle, `pg` or `@hono/zod-openapi`** — the manager
// is a client component, so this stays plain zod, like `product-input.ts`.
// Server-owned fields (`id`, `createdAt`, `updatedAt`) are not in the object, so
// a body carrying them has them stripped rather than applied.
import { z } from 'zod';
import { toPersianDigits } from '@/lib/format';
import { SLUG_PATTERN } from './product-input';
import { MAX_SLUG_LENGTH } from './sku';

/**
 * A category title is rendered on every storefront page (the category strip) and
 * in the product form's select, so it is capped rather than left to grow.
 */
export const MAX_TITLE_LENGTH = 100;

/**
 * Characters a title may not carry, as escapes (never typed): every control
 * character — NUL among them, which Postgres refuses as a 500 — and the bidi
 * embeddings, overrides and isolates (U+202A–U+202E, U+2066–U+2069), which
 * reorder the surrounding text wherever the title is shown. ZWNJ is deliberately
 * allowed: Persian words need it («دسته‌بندی»).
 */
const FORBIDDEN_TITLE_CHARS = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;

/** At least one letter, digit, punctuation mark or symbol — not just invisibles. */
const VISIBLE_CHAR = /[\p{L}\p{N}\p{P}\p{S}]/u;

/** `categories.sort_order` is a Postgres `integer`; past this the write would 500. */
export const MAX_SORT_ORDER = 2_147_483_647;

/** Persian, user-facing — these strings surface on the manager's fields. */
export const CATEGORY_MESSAGES = {
  title: 'عنوان دسته‌بندی الزامی است.',
  titleLength: `عنوان دسته‌بندی حداکثر ${toPersianDigits(MAX_TITLE_LENGTH)} نویسه است.`,
  titleChars: 'عنوان دسته‌بندی نویسه‌های نامعتبر دارد.',
  slug: 'نشانی فقط با حروف کوچک انگلیسی، عدد و خط تیره (حداقل ۳ نویسه).',
  slugLength: `نشانی حداکثر ${toPersianDigits(MAX_SLUG_LENGTH)} نویسه است.`,
  sortOrder: 'ترتیب نمایش باید عددی صحیح و صفر یا بیشتر باشد.',
} as const;

// `{ error }` on each base type too, not only on the refinements: a missing or
// wrong-typed field fails the base check, and without it zod falls back to its
// English message instead of the Persian copy.
export const categoryInputSchema = z.object({
  title: z
    .string({ error: CATEGORY_MESSAGES.title })
    .trim()
    .min(1, CATEGORY_MESSAGES.title)
    .max(MAX_TITLE_LENGTH, CATEGORY_MESSAGES.titleLength)
    .refine((value) => !FORBIDDEN_TITLE_CHARS.test(value), {
      error: CATEGORY_MESSAGES.titleChars,
    })
    // `trim()` leaves ZWNJ and friends, so an all-invisible title reads as blank.
    .refine((value) => VISIBLE_CHAR.test(value), {
      error: CATEGORY_MESSAGES.title,
    }),
  // Capped like a product slug (MAX_SLUG_LENGTH): it becomes a storefront URL
  // segment and ships in the public category API, so one bad paste must not
  // turn into an oversized row, link and response.
  slug: z
    .string({ error: CATEGORY_MESSAGES.slug })
    .trim()
    .max(MAX_SLUG_LENGTH, CATEGORY_MESSAGES.slugLength)
    .regex(SLUG_PATTERN, CATEGORY_MESSAGES.slug),
  sortOrder: z
    .number({ error: CATEGORY_MESSAGES.sortOrder })
    .int(CATEGORY_MESSAGES.sortOrder)
    .nonnegative(CATEGORY_MESSAGES.sortOrder)
    .max(MAX_SORT_ORDER, CATEGORY_MESSAGES.sortOrder),
});

/** The validated body — assignable to `CategoryDao`'s `CategoryInput`. */
export type CategoryInputBody = z.infer<typeof categoryInputSchema>;
