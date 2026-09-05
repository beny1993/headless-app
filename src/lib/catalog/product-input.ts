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
//   · Server-owned fields are absent. `id`, `searchText`, `createdAt`,
//     `updatedAt` are not in the object, so a body carrying them has them
//     stripped rather than applied — the DAO owns `searchText`, the database
//     owns the id and the timestamps.
import { z } from 'zod';
import { PET_TYPES } from './product-query';

/** Persian, user-facing — these strings surface on the form's fields. */
const MESSAGES = {
  title: 'عنوان محصول الزامی است.',
  slug: 'نشانی فقط با حروف کوچک انگلیسی، عدد و خط تیره (حداقل ۳ نویسه).',
  sku: 'کد کالا (SKU) الزامی است — روی اقلام سفارش ثبت می‌شود.',
  category: 'دسته‌بندی را انتخاب کن.',
  price: 'قیمت باید عددی صحیح و بزرگ‌تر از صفر باشد (تومان).',
  oldPrice: 'قیمت قبلی باید عددی صحیح و بیشتر از قیمت فعلی باشد.',
  stock: 'موجودی باید عددی صحیح و صفر یا بیشتر باشد.',
  pet: 'نوع حیوان نامعتبر است.',
} as const;

/** Latin URL segment; the same shape the categories schema documents. */
export const SLUG_PATTERN = /^[a-z0-9-]{3,}$/;

/** Integer Toman, strictly positive — the `products_price_positive` CHECK. */
// `{ error }` on the base `z.number()` too, not only on `.int()`/`.positive()`:
// a blank/NaN/null field fails the base type check, and without it zod would fall
// back to its English "expected number, received NaN" instead of the Persian copy.
const priceToman = z
  .number({ error: MESSAGES.price })
  .int(MESSAGES.price)
  .positive(MESSAGES.price);

/**
 * An optional free-text field: trimmed, and an empty (or whitespace-only) value
 * becomes `null` rather than `''`, so "cleared in the form" and "never set" are
 * one state in the column. Accepts a missing key, `null`, or a string.
 */
const optionalText = z
  .string()
  .trim()
  .nullish()
  .transform((value) => value || null);

export const productInputSchema = z
  .object({
    title: z.string().trim().min(3, MESSAGES.title),
    slug: z.string().trim().regex(SLUG_PATTERN, MESSAGES.slug),
    sku: z.string().trim().min(1, MESSAGES.sku),
    brand: optionalText,
    description: optionalText,
    benefit: optionalText,
    price: priceToman,
    // Only ever set to show a struck-through "was" price; the cross-field rule
    // below (and the `products_old_price_above_price` CHECK) require it above
    // the current price. `null` when there is no discount.
    oldPrice: z
      .number({ error: MESSAGES.oldPrice })
      .int(MESSAGES.oldPrice)
      .positive(MESSAGES.oldPrice)
      .nullish(),
    stock: z
      .number({ error: MESSAGES.stock })
      .int(MESSAGES.stock)
      .nonnegative(MESSAGES.stock),
    categoryId: z.uuid(MESSAGES.category),
    petType: z.enum([PET_TYPES.CAT, PET_TYPES.DOG], MESSAGES.pet),
    // A real editable field — the design's «نمایش در فروشگاه» toggle. Soft delete
    // is the DELETE route, not this flag; but an admin may deactivate a product
    // by unchecking it here too.
    isActive: z.boolean(),
  })
  // A full-body contract, not a patch: `oldPrice > price` is a cross-field rule,
  // and a partial body could not evaluate it without reading the row first (and
  // would then trip the CHECK as a 500). The update route replaces the whole row.
  .refine((data) => data.oldPrice == null || data.oldPrice > data.price, {
    error: MESSAGES.oldPrice,
    path: ['oldPrice'],
  });

/** The validated body — assignable to `ProductDao`'s `ProductInput`. */
export type ProductInputBody = z.infer<typeof productInputSchema>;
