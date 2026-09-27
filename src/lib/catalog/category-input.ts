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
import { imageKeySchema } from '@/lib/storage/image-upload';
import { FORBIDDEN_TEXT_CHARS, VISIBLE_CHAR } from '@/lib/validation/text';
import { SLUG_PATTERN } from './product-input';
import { MAX_SLUG_LENGTH } from './sku';

/**
 * A category title is rendered on every storefront page (the category strip) and
 * in the product form's select, so it is capped rather than left to grow.
 */
export const MAX_TITLE_LENGTH = 100;

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
  parent: 'دسته‌بندی مادر نامعتبر است.',
} as const;

/**
 * Why a parent was refused. The database cannot see another row, so these four
 * are `CategoryDao`'s to decide — the schema only checks that the id is an id.
 */
export type CategoryParentReason =
  'self' | 'unknown' | 'nested' | 'hasChildren';

/**
 * The refusals, in Persian. The routes send them as `parentId: <message>`, which
 * `parseFieldErrors` drops under the manager's parent select; `hasChildren` is
 * also that select's hint while it is disabled, so both say the same sentence.
 */
export const CATEGORY_PARENT_MESSAGES: Record<CategoryParentReason, string> = {
  self: 'یک دسته‌بندی نمی‌تواند مادر خودش باشد.',
  unknown: 'دسته‌بندی مادر یافت نشد؛ صفحه را تازه کن.',
  nested: 'دسته‌بندی مادر خودش زیردسته است؛ بیش از یک سطح زیردسته نداریم.',
  hasChildren: 'این دسته‌بندی زیردسته دارد و خودش نمی‌تواند زیردسته شود.',
};

// `{ error }` on each base type too, not only on the refinements: a missing or
// wrong-typed field fails the base check, and without it zod falls back to its
// English message instead of the Persian copy.
export const categoryInputSchema = z.object({
  title: z
    .string({ error: CATEGORY_MESSAGES.title })
    .trim()
    .min(1, CATEGORY_MESSAGES.title)
    .max(MAX_TITLE_LENGTH, CATEGORY_MESSAGES.titleLength)
    .refine((value) => !FORBIDDEN_TEXT_CHARS.test(value), {
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
  // PUT replaces the whole category, so an omitted parent means «top-level»,
  // not «leave it alone» — which is also what keeps every body written before
  // sub-categories existed valid. Whether the id names a category, and whether
  // that category may be a parent, is `CategoryDao`'s call: a schema cannot see
  // another row.
  parentId: z.uuid(CATEGORY_MESSAGES.parent).nullable().default(null),
  // The tile photo's storage key: the manager uploads the file through the
  // shared content-image route first and sends back the key it was given, the
  // content editor's flow. Unlike the fields above, omitted is not «none»: it
  // leaves the photo as it is, and only an explicit null removes it — so a
  // client that knows nothing of photos (an admin tab opened before they
  // shipped) cannot wipe one by saving a title. A replaced key's file stays in
  // storage: deleting it would first need proof the key is this category's own
  // — a body can name any well-formed key — and category photos change too
  // rarely to leave anything worth collecting.
  imageKey: imageKeySchema.nullable().optional(),
});

/** The validated body — assignable to `CategoryDao`'s `CategoryInput`. */
export type CategoryInputBody = z.infer<typeof categoryInputSchema>;
