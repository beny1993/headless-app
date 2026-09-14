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
import { PET_TYPES } from './product-query';
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
};

/** Latin URL segment; the same shape the categories schema documents. */
export const SLUG_PATTERN = /^[a-z0-9-]{3,}$/;

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
    petType: z.enum([PET_TYPES.CAT, PET_TYPES.DOG], PRODUCT_MESSAGES.pet),
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
