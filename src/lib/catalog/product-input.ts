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
import { imageKeySchema } from '@/lib/storage/image-upload';
import { toPersianDigits } from '@/lib/format';
import { hasNoForbiddenChars, VISIBLE_CHAR } from '@/lib/validation/text';
import {
  PET_TYPE_VALUES,
  normalizePetTypes,
  type PetType,
} from './product-query';
import { MAX_SLUG_LENGTH } from './sku';
import { VARIANT_LABEL_LIMIT, VARIANT_MESSAGES } from './variant';

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
 * The shortest slug either catalog form accepts. `SLUG_PATTERN` and both slug
 * refusals derive from it, so the pattern and the message quoting it cannot
 * drift apart.
 */
export const MIN_SLUG_LENGTH = 3;

/**
 * How many categories a product may carry beyond its main one — so six in all.
 * A product filed everywhere makes every filter meaningless.
 */
export const MAX_EXTRA_CATEGORIES = 5;

/**
 * How many photos a product may carry. The first is the cover — the shop card,
 * the admin list thumbnail and the product page's opening image — and the rest
 * are the other views. Client-safe, so the admin field, the reorder schema and
 * the upload route all read one number.
 */
export const MAX_PRODUCT_IMAGES = 5;

/** Persian, user-facing — these strings surface on the form's fields. */
export const PRODUCT_MESSAGES = {
  title: 'عنوان محصول الزامی است.',
  titleLength: tooLong('عنوان محصول', PRODUCT_TEXT_LIMITS.title),
  slug: `نشانی فقط با حروف کوچک انگلیسی، عدد و خط تیره (حداقل ${toPersianDigits(MIN_SLUG_LENGTH)} نویسه).`,
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
  // The gallery pair, said the same way as the categories pair above: one
  // sentence for a key that is malformed and for one no image of this product
  // has, because to the admin both mean «the page you are looking at is stale».
  images: 'یکی از عکس‌های انتخاب‌شده یافت نشد؛ صفحه را تازه کن.',
  imagesMax: `حداکثر ${toPersianDigits(MAX_PRODUCT_IMAGES)} عکس برای هر محصول می‌توانی بارگذاری کنی.`,
};

/** Latin URL segment; the same shape the categories schema documents. */
export const SLUG_PATTERN = new RegExp(`^[a-z0-9-]{${MIN_SLUG_LENGTH},}$`);

/**
 * An array element that accepts anything, so a bad one is reported by the
 * array's own check instead of by the element's.
 *
 * `formatZodIssues` renders an element issue as `petTypes.0`, and both the form
 * and `parseFieldErrors` look an error up by its exact field name — so such an
 * issue is one no field ever shows, and the admin gets a refused save with no
 * message anywhere. `meta` is what keeps the element's real shape in the
 * OpenAPI document, which is the only other job the element schema had.
 */
const anyElement = (meta: Record<string, unknown>) => z.unknown().meta(meta);

/** zod's own uuid rule, applied to the whole array rather than element-wise. */
const UUID = z.uuid();

const isUuid = (value: unknown): value is string =>
  UUID.safeParse(value).success;

const isPetType = (value: unknown): value is PetType =>
  (PET_TYPE_VALUES as readonly unknown[]).includes(value);

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
 * An optional free-text field: trimmed, and a value with nothing readable in it
 * becomes `null` rather than `''`, so "cleared in the form" and "never set" are
 * one state in the column. Accepts a missing key, `null`, or a string. Capped at
 * `max` and free of forbidden characters; `multiline` keeps line breaks.
 *
 * `VISIBLE_CHAR` rather than a bare truthiness test, and it is the same rule
 * {@link requiredText} applies: `trim()` does not remove ZWNJ, which
 * `FORBIDDEN_TEXT_CHARS` deliberately allows because Persian words need it — so
 * a field of nothing but ZWNJ survived as a string that renders as blank
 * everywhere it is shown. `variantLabel` is where that bites hardest: a member
 * whose label is invisible gets a chip with no text on it, and the cross-field
 * rule below can only see it once the label is `null`.
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
    .transform((value) => (value && VISIBLE_CHAR.test(value) ? value : null));

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
    // Validated as a whole rather than element by element — see `anyElement`.
    extraCategoryIds: z
      .array(
        anyElement({ type: 'string', format: 'uuid' }),
        PRODUCT_MESSAGES.extraCategories,
      )
      .max(MAX_EXTRA_CATEGORIES, PRODUCT_MESSAGES.extraCategoriesMax)
      .refine((ids) => ids.every(isUuid), {
        error: PRODUCT_MESSAGES.extraCategories,
      })
      .transform((ids) => ids as string[])
      // Absent means «none», so every body written before this field existed
      // stays valid.
      .default([]),
    // One pet or both, stored in the canonical order with duplicates dropped —
    // so `['dog','cat']` and `['cat','cat','dog']` reach the column as the one
    // value they mean. The form runs this very schema, so «at least one» is one
    // sentence said in one place (A1).
    petTypes: z
      .array(
        anyElement({ type: 'string', enum: PET_TYPE_VALUES }),
        PRODUCT_MESSAGES.petRequired,
      )
      .min(1, PRODUCT_MESSAGES.petRequired)
      // Checked on the array, not on the element, for `anyElement`'s reason.
      .refine((values) => values.every(isPetType), {
        error: PRODUCT_MESSAGES.pet,
      })
      .transform((values) => normalizePetTypes(values as PetType[])),
    // The product this one is a variant of — a smell, a colour, a size — or
    // `null` for a standalone product and for a family's head, which points at
    // nothing itself. That «head points at nothing» is what lets the storefront
    // listing be one predicate (`variant_of is null`) instead of a grouping.
    //
    // Only the shape is checked here. «One level deep», «the head exists» and
    // «the head has a label of its own» each need to read another row, so they
    // live in `ProductDao` beside the category-parent rules, which cannot be
    // CHECKs for the same reason.
    variantOf: z
      .uuid(VARIANT_MESSAGES.unknownHead)
      .nullish()
      .transform((value) => value ?? null),
    // What distinguishes this member from its siblings. Set on every member
    // *and* on the head; `null` on a standalone product.
    variantLabel: optionalText(
      VARIANT_LABEL_LIMIT,
      VARIANT_MESSAGES.labelLength,
    ),
    // A real editable field — the design's «نمایش در فروشگاه» toggle. Soft delete
    // is the DELETE route, not this flag; but an admin may deactivate a product
    // by unchecking it here too.
    isActive: z.boolean(),
  })
  // A full-body contract, not a patch: `oldPrice > price` is a cross-field rule,
  // and a partial body could not evaluate it without reading the row first (and
  // would then trip the CHECK as a 500). The update route replaces the whole row.
  //
  // `path` is not decoration, and this is the only place that says so: a root
  // refine without one produces a path-LESS issue, `formatZodIssues` sends it
  // out as a bare sentence, `parseFieldErrors` finds no field path in it and
  // files it under `unmapped` — which the admin form shows in a toast
  // verbatim. That channel is deliberate (the «this product has members»
  // refusal travels it, and is Persian), so anything landing there must be
  // Persian too. Give every root refine a `path`, or write its message as copy
  // fit for a person to read.
  .refine((data) => data.oldPrice == null || data.oldPrice > data.price, {
    error: PRODUCT_MESSAGES.oldPrice,
    path: ['oldPrice'],
  })
  // A member with no label renders an empty chip on the product page and an
  // order line ending in a bare dash. Keyed on `variantLabel` because that is
  // the field the form renders — an issue on `variantOf` would be shown by the
  // select, which is not where the admin has to type. `path` again: see above
  // for what a root refine without one puts in an admin's toast.
  .refine((data) => data.variantOf == null || data.variantLabel != null, {
    error: VARIANT_MESSAGES.label,
    path: ['variantLabel'],
  });

/** The inventory observed when opening the edit form; required for safe stock writes. */
export const productUpdateInputSchema = productInputSchema.safeExtend({
  expectedStock: z.number().int().nonnegative().max(MAX_STOCK),
});

/**
 * Is this a stored image key? The shape lives with the uploader that mints it
 * (`@/lib/storage/image-upload`), so this asks that one rather than answering
 * again — a second, looser definition here accepted any short string, and the
 * two would have drifted the moment an accepted type was added. The predicate
 * wrapper is the file's own idiom, as `isUuid` above.
 */
const isObjectKey = (value: unknown): value is string =>
  imageKeySchema.safeParse(value).success;

/**
 * The gallery-order body: this product's own image keys, in the order the admin
 * arranged them, with the removed ones simply absent.
 *
 * Keys rather than `product_images.id`, and that is deliberate: a gallery-order
 * write replaces every row, so every id changes with it, while the object key —
 * generated server-side by `objectKeyFor` and never by the client — survives.
 * A form that had sent ids would be sending dead ones as soon as it saved. (An
 * *upload* leaves ids alone: it appends one row. The churn is this write's.)
 *
 * Shape only, as with `extraCategoryIds`: «every key is one of *this* product's»
 * is set membership against a row no schema can read, so the route checks it
 * and answers with this same sentence.
 */
export const productImagesOrderSchema = z.object({
  objectKeys: z
    .array(anyElement({ type: 'string' }), PRODUCT_MESSAGES.images)
    .max(MAX_PRODUCT_IMAGES, PRODUCT_MESSAGES.imagesMax)
    .refine((keys) => keys.every(isObjectKey), {
      error: PRODUCT_MESSAGES.images,
    })
    // A repeated key would store the same photo twice and make «remove this
    // one» ambiguous. Refused rather than deduped: it can only come from a
    // client bug, and silently changing what was sent hides it.
    .refine((keys) => new Set(keys).size === keys.length, {
      error: PRODUCT_MESSAGES.images,
    })
    .transform((keys) => keys as string[]),
});
