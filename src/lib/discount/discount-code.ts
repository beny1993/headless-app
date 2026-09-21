// The discount-code contract — one client-safe definition shared by the admin
// create form (which validates before it sends and maps `path: message` errors
// back onto its fields), the admin API route (which rejects a bad body with 400),
// the Drizzle schema (which builds the `discount_type` pgEnum from the values
// here, so the DB domain and the client's are one definition — the same rule
// `order-status` obeys for the order enums), and the server-side money math.
//
// **Nothing here may import drizzle, `pg` or `@hono/zod-openapi`** — the admin
// form is a client component, so this stays plain zod, exactly like
// `product-input.ts` and `checkout-input.ts` (see the notes there). The
// `DiscountCode` row is a TYPE import, which is erased; keeping the admin
// projection here is what stops the discounts server page importing a value out
// of a Hono route for one pure function.
//
// Money invariants the security pass will probe live here, not just in the UI:
//   · A percent code is 1–100; a fixed code is a strictly-positive integer Toman.
//     The `discriminatedUnion` is the client-safe twin of the type-aware CHECK in
//     the schema, so the form and the database agree without the route
//     re-checking.
//   · Server-owned fields (`id`, `usageCount`, timestamps) are absent, so a body
//     that smuggles `usageCount: 0` or `id` has them stripped rather than applied
//     — the database owns the id and the timestamps, and only the atomic claim at
//     checkout ever moves `usageCount`.
import { z } from 'zod';
import type { DiscountCode } from '@/db/schema/discounts';
import { MAX_DISCOUNT_CODE } from '@/lib/checkout/checkout-input';

export const DISCOUNT_TYPES = {
  /** A percentage off the subtotal (`value` is 1–100). */
  PERCENT: 'percent',
  /** A flat integer-Toman amount off (`value` is the amount). */
  FIXED: 'fixed',
} as const;

export type DiscountType = (typeof DISCOUNT_TYPES)[keyof typeof DISCOUNT_TYPES];

/** The enum domain, in a stable order — the `discount_type` pgEnum is built from this. */
export const DISCOUNT_TYPE_VALUES = [
  DISCOUNT_TYPES.PERCENT,
  DISCOUNT_TYPES.FIXED,
] as const;

export const discountTypeSchema = z.enum(DISCOUNT_TYPE_VALUES);

/**
 * The canonical storage/lookup form of a code: trimmed and upper-cased, so
 * `welcome10`, `WELCOME10` and `  Welcome10 ` are one code. Applied by the DAO on
 * write and by the checkout/preview lookup on read, so the two never disagree.
 * Codes are ASCII (see `codeField`), so a plain `toUpperCase()` is exact.
 */
export const normalizeCode = (raw: string): string => raw.trim().toUpperCase();

/**
 * The integer-Toman discount for a code against a server-computed subtotal.
 *
 * `percent` → `floor(subtotal × value / 100)`: **floor**, never round, so the
 * shop never grants a Toman more than the stated percentage. `fixed` → the stored
 * amount. Either way the result is clamped to `[0, subtotal]` — a discount can
 * never exceed the goods subtotal, so `subtotal - discount` is never negative and
 * the order total never dips below the shipping fee.
 *
 * Pure and server-only (both `createOrder` and the preview call it); the subtotal
 * is always the SERVER's re-priced figure, never a client-supplied one.
 */
export const computeDiscount = (
  code: { type: DiscountType; value: number },
  subtotal: number,
): number => {
  const raw =
    code.type === DISCOUNT_TYPES.PERCENT
      ? // Inputs and the result fit a safe integer, but the intermediate product
        // can exceed it. Divide as bigint before converting back to integer Toman.
        Number((BigInt(subtotal) * BigInt(code.value)) / 100n)
      : code.value;
  return Math.min(Math.max(raw, 0), subtotal);
};

/** Persian, user-facing — surfaced on the admin form's fields. */
const MESSAGES = {
  code: 'کد تخفیف فقط با حروف انگلیسی، عدد و خط تیره (بدون فاصله).',
  type: 'نوع تخفیف نامعتبر است.',
  percent: 'درصد تخفیف باید عددی صحیح بین ۱ تا ۱۰۰ باشد.',
  fixed: 'مبلغ تخفیف باید عددی صحیح و بزرگ‌تر از صفر باشد (تومان).',
  minOrder: 'حداقل مبلغ سفارش باید عددی صحیح و صفر یا بیشتر باشد (تومان).',
  usageLimit: 'سقف استفاده باید عددی صحیح و بزرگ‌تر از صفر باشد.',
  expiresAt: 'تاریخ انقضا نامعتبر است.',
} as const;

/** ASCII code, upper-cased on the way in so storage and lookup share one form. */
const codeField = z
  .string()
  .trim()
  .min(1, MESSAGES.code)
  .max(MAX_DISCOUNT_CODE, MESSAGES.code)
  .regex(/^[A-Za-z0-9-]+$/, MESSAGES.code)
  .transform((value) => value.toUpperCase());

/**
 * An optional expiry: an ISO date (`2026-12-31`) or datetime, `null`, or absent —
 * all meaning "set/clear the expiry". Parsed to a `Date` for the DAO; `null` is
 * "no expiry" (the column is nullable).
 */
const expiresAtField = z
  .union([
    z.iso.datetime({ error: MESSAGES.expiresAt }),
    z.iso.date(MESSAGES.expiresAt),
  ])
  .nullish()
  .transform((value) => (value ? new Date(value) : null));

/** The fields every code carries, regardless of type. */
const sharedFields = {
  code: codeField,
  expiresAt: expiresAtField,
  usageLimit: z
    .number()
    .int(MESSAGES.usageLimit)
    .positive(MESSAGES.usageLimit)
    .max(2_147_483_647, MESSAGES.usageLimit)
    .nullish(),
  minOrderAmount: z
    .number()
    .int(MESSAGES.minOrder)
    .nonnegative(MESSAGES.minOrder)
    .default(0),
  // A create defaults to active; the admin can uncheck it or toggle it later.
  isActive: z.boolean().default(true),
};

/**
 * The admin create body. A `discriminatedUnion` on `type` so `value` is validated
 * against the right range for its kind — the client-safe twin of the schema's
 * type-aware CHECK. The output is assignable to `DiscountCodeDao`'s
 * `DiscountCodeInput`, so what passes here is what the DAO stores.
 */
export const discountCodeInputSchema = z.discriminatedUnion('type', [
  z.object({
    ...sharedFields,
    type: z.literal(DISCOUNT_TYPES.PERCENT),
    value: z
      .number()
      .int(MESSAGES.percent)
      .min(1, MESSAGES.percent)
      .max(100, MESSAGES.percent),
  }),
  z.object({
    ...sharedFields,
    type: z.literal(DISCOUNT_TYPES.FIXED),
    value: z.number().int(MESSAGES.fixed).positive(MESSAGES.fixed),
  }),
]);

/** The validated create body — assignable to `DiscountCodeDao`'s input. */
export type DiscountCodeInputBody = z.infer<typeof discountCodeInputSchema>;

/** The toggle body — the only mutable field after creation (deactivate/reactivate). */
export const discountCodeToggleSchema = z.object({ isActive: z.boolean() });

/**
 * The admin view of a discount code — the full row the panel shows, with the
 * timestamps and expiry ISO-stringified for the client. `usageCount` is
 * read-only here (the atomic claim owns it); it is shown so the admin sees
 * remaining capacity.
 *
 * Defined here rather than in the route so the discounts server page can
 * project rows without importing `@/lib/hono/routes/*` as a value.
 * `src/lib/hono/routes/admin-discounts.ts` registers it under `DiscountCode`.
 */
export const discountCodeViewSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  type: discountTypeSchema,
  value: z.number().int().positive(),
  expiresAt: z.iso.datetime().nullable(),
  usageLimit: z.number().int().positive().nullable(),
  usageCount: z.number().int().nonnegative(),
  minOrderAmount: z.number().int().nonnegative(),
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** The discount payload — what create/toggle return, and the admin list renders. */
export type DiscountCodeView = z.infer<typeof discountCodeViewSchema>;

/** Project a DAO row to the admin response — ISO the dates. */
export const toDiscountView = (c: DiscountCode): DiscountCodeView => ({
  id: c.id,
  code: c.code,
  type: c.type,
  value: c.value,
  expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
  usageLimit: c.usageLimit,
  usageCount: c.usageCount,
  minOrderAmount: c.minOrderAmount,
  isActive: c.isActive,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});
