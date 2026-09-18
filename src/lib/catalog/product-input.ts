// The create/edit-product body contract — one zod schema shared by the admin API
// route (which rejects a bad body with 400) and the admin product form (which
// validates before it sends and maps `path: message` errors back onto its
// fields). Derive, never hand-mirror: the form does not restate these rules.
//
// **Nothing here may import drizzle, `pg` or `@hono/zod-openapi`** — the form is
// a client component, so this stays plain zod, exactly like `product-query.ts`
// (see the note there). Its output is assignable to `ProductInput` in
// `ProductDao`, so what passes validation is what the DAO stores.
//
// Two invariants the security pass will probe live here, not just in the UI:
//   · Money is integer Toman. `price > 0` and `stock >= 0` mirror the CHECK
//     constraints; `.int()` also caps values at Number.MAX_SAFE_INTEGER (zod 4),
//     the ceiling `bigint`-as-`number` columns can represent without precision
//     loss — so no float, no overflow, reaches Postgres.
//   · Server-owned fields are absent. `id`, `sku`, `searchText`, `createdAt`,
//     `updatedAt` are not in the object, so a body carrying them has them
//     stripped rather than applied — the create route derives `sku` from the
//     slug (`./sku.ts`), the DAO owns `searchText`, and the database owns the
//     id and the timestamps.
//   · Free text is bounded and printable. Every text field is length-capped and
//     refuses control characters (a NUL reaches Postgres as a 500) and bidi
//     overrides; only `description` keeps tab and line breaks.
import { z } from 'zod';
import { toPersianDigits } from '@/lib/format';
import { FORBIDDEN_TEXT_CHARS, VISIBLE_CHAR } from '@/lib/validation/text';
import { PET_TYPE_VALUES, normalizePetTypes } from './product-query';
import { MAX_SLUG_LENGTH } from './sku';

/**
 * The longest value each free-text field accepts, measured after trimming. Every
 * one is rendered on storefront pages, so none is left unbounded.
 */
export const PRODUCT_TEXT_LIMITS = {
  title: 150,
  brand: 100,
  benefit: 200,
  description: 5000,
} as const;

const tooLong = (label: string, max: number) =>
  `${label} حداکثر ${toPersianDigits(max)} نویسه است.`;

/** `products.stock` is a Postgres `integer`; past this the write would 500. */
const MAX_STOCK = 2_147_483_647;

/**
 * How many categories a product may carry beyond its main one — so six in all.
 * A product filed everywhere makes every filter meaningless.
 */
export const MAX_EXTRA_CATEGORIES = 5;

/** Persian, user-facing — these strings surface on the form's fields. */
export const PRODUCT_MESSAGES = {
  title: 'عنوان محصول الزامی است.',
  titleLength: tooLong('عنوان محصول', PRODUCT_TEXT_LIMITS.title),
  slug: 'نشانی فقط با حروف کوچک انگلیسی، عدد و خط تیره (حداقل ۳ نویسه).',
  slugLength: tooLong('نشانی یکتا (slug)', MAX_SLUG_LENGTH),
  brandLength: tooLong('برند', PRODUCT_TEXT_LIMITS.brand),
  benefitLength: tooLong('جمله مزیت', PRODUCT_TEXT_LIMITS.benefit),
  descriptionLength: tooLong('توضیحات', PRODUCT_TEXT_LIMITS.description),
  textChars: 'متن نویسه‌های نامعتبر دارد.',
  category: 'دسته‌بندی را انتخاب کن.',
  price: 'قیمت باید عددی صحیح و بزرگ‌تر از صفر باشد (تومان).',
  oldPrice: 'قیمت قبلی باید عددی صحیح و بیشتر از قیمت فعلی باشد.',
  stock: 'موجودی باید عددی صحیح و صفر یا بیشتر باشد.',
  pet: 'نوع حیوان نامعتبر است.',
  petRequired: 'حداقل یک نوع حیوان را انتخاب کن.',
  // One sentence for a malformed id and for an id no category has: the form
  // only ever sends ids it was given, so to the admin both are «the list you
  // are looking at is stale», and the route maps the junction's foreign-key
  // refusal onto this same string.
  extraCategories: 'یکی از دسته‌بندی‌های انتخاب‌شده یافت نشد؛ صفحه را تازه کن.',
  extraCategoriesMax: `حداکثر ${toPersianDigits(MAX_EXTRA_CATEGORIES)} دسته‌بندی دیگر می‌توانی انتخاب کنی.`,
};

/** Latin URL segment; the same shape the categories schema documents. */
export const SLUG_PATTERN = /^[a-z0-9-]{3,}$/;

/** zod's own uuid rule, reused element-wise without its indexed error path. */
const UUID = z.uuid();

/** No forbidden characters; `multiline` lets tab, line feed and carriage return through. */
const hasNoForbiddenChars = (multiline: boolean) => (value: string) =>
  !FORBIDDEN_TEXT_CHARS.test(
    multiline ? value.replace(/[\t\n\r]/g, '') : value,
  );

/**
 * A required single-line text field: trimmed, `min`–`max` long, free of forbidden
 * characters, and not made only of invisible ones (that reads as missing).
 */
const requiredText = (
  min: number,
  max: number,
  message: string,
  lengthMessage: string,
) =>
  z
    .string({ error: message })
    .trim()
    .min(min, message)
    .max(max, lengthMessage)
    .refine(hasNoForbiddenChars(false), { error: PRODUCT_MESSAGES.textChars })
    .refine((value) => VISIBLE_CHAR.test(value), { error: message });

/** Integer Toman, strictly positive — the `products_price_positive` CHECK. */
// `{ error }` on the base `z.number()` too, not only on `.int()`/`.positive()`:
// a blank/NaN/null field fails the base type check, and without it zod would fall
// back to its English "expected number, received NaN" instead of the Persian copy.
const priceToman = z
  .number({ error: PRODUCT_MESSAGES.price })
  .int(PRODUCT_MESSAGES.price)
  .positive(PRODUCT_MESSAGES.price);

/**
 * An optional free-text field: trimmed, and an empty (or whitespace-only) value
 * becomes `null` rather than `''`, so "cleared in the form" and "never set" are
 * one state in the column. Accepts a missing key, `null`, or a string. Capped at
 * `max` and free of forbidden characters; `multiline` keeps line breaks.
 */
const optionalText = (max: number, lengthMessage: string, multiline = false) =>
  z
    .string()
    .trim()
    .max(max, lengthMessage)
    .refine(hasNoForbiddenChars(multiline), {
      error: PRODUCT_MESSAGES.textChars,
    })
    .nullish()
    .transform((value) => value || null);

export const productInputSchema = z
  .object({
    title: requiredText(
      3,
      PRODUCT_TEXT_LIMITS.title,
      PRODUCT_MESSAGES.title,
      PRODUCT_MESSAGES.titleLength,
    ),
    slug: z
      .string()
      .trim()
      .max(MAX_SLUG_LENGTH, PRODUCT_MESSAGES.slugLength)
      .regex(SLUG_PATTERN, PRODUCT_MESSAGES.slug),
    brand: optionalText(
      PRODUCT_TEXT_LIMITS.brand,
      PRODUCT_MESSAGES.brandLength,
    ),
    description: optionalText(
      PRODUCT_TEXT_LIMITS.description,
      PRODUCT_MESSAGES.descriptionLength,
      true,
    ),
    benefit: optionalText(
      PRODUCT_TEXT_LIMITS.benefit,
      PRODUCT_MESSAGES.benefitLength,
    ),
    price: priceToman,
    // Only ever set to show a struck-through "was" price; the cross-field rule
    // below (and the `products_old_price_above_price` CHECK) require it above
    // the current price. `null` when there is no discount.
    oldPrice: z
      .number({ error: PRODUCT_MESSAGES.oldPrice })
      .int(PRODUCT_MESSAGES.oldPrice)
      .positive(PRODUCT_MESSAGES.oldPrice)
      .nullish(),
    stock: z
      .number({ error: PRODUCT_MESSAGES.stock })
      .int(PRODUCT_MESSAGES.stock)
      .nonnegative(PRODUCT_MESSAGES.stock)
      .max(MAX_STOCK, PRODUCT_MESSAGES.stock),
    categoryId: z.uuid(PRODUCT_MESSAGES.category),
    // The categories beyond the main one. Bounded here; the DAO is the one
    // canonicalizer (it dedupes and drops the main one) because the seed
    // bypasses zod and two copies of that rule would drift.
    //
    // Validated as a whole rather than element by element, so a malformed id
    // raises ONE issue at path `extraCategoryIds`: `formatZodIssues` turns an
    // element issue into `extraCategoryIds.1`, and the form looks its errors
    // up by exact key, so that would be an error no field ever shows.
    extraCategoryIds: z
      .array(z.string(), PRODUCT_MESSAGES.extraCategories)
      .max(MAX_EXTRA_CATEGORIES, PRODUCT_MESSAGES.extraCategoriesMax)
      .refine((ids) => ids.every((id) => UUID.safeParse(id).success), {
        error: PRODUCT_MESSAGES.extraCategories,
      })
      // Absent means «none», so every body written before this field existed
      // stays valid.
      .default([]),
    // One pet or both, stored in the canonical order with duplicates dropped —
    // so `['dog','cat']` and `['cat','cat','dog']` reach the column as the one
    // value they mean. The form runs this very schema, so «at least one» is one
    // sentence said in one place (A1).
    petTypes: z
      .array(
        z.enum(PET_TYPE_VALUES, PRODUCT_MESSAGES.pet),
        PRODUCT_MESSAGES.petRequired,
      )
      .min(1, PRODUCT_MESSAGES.petRequired)
      .transform(normalizePetTypes),
    // A real editable field — the design's «نمایش در فروشگاه» toggle. Soft delete
    // is the DELETE route, not this flag; but an admin may deactivate a product
    // by unchecking it here too.
    isActive: z.boolean(),
  })
  // A full-body contract, not a patch: `oldPrice > price` is a cross-field rule,
  // and a partial body could not evaluate it without reading the row first (and
  // would then trip the CHECK as a 500). The update route replaces the whole row.
  .refine((data) => data.oldPrice == null || data.oldPrice > data.price, {
    error: PRODUCT_MESSAGES.oldPrice,
    path: ['oldPrice'],
  });

/** The validated body — assignable to `ProductDao`'s `ProductInput`. */
export type ProductInputBody = z.infer<typeof productInputSchema>;

/** The inventory observed when opening the edit form; required for safe stock writes. */
export const productUpdateInputSchema = productInputSchema.safeExtend({
  expectedStock: z.number().int().nonnegative().max(MAX_STOCK),
});
