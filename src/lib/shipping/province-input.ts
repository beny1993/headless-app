// The admin province contract — one client-safe definition shared by the admin
// API routes (`POST /api/admin/provinces`, `PATCH /api/admin/provinces/{id}`,
// which reject a bad body with 400), the rate editor's create form, and the two
// storefront forms that warn about an address on a deactivated province. Derive,
// never hand-mirror.
//
// **Nothing here may import drizzle, `pg` or `@hono/zod-openapi`** — the forms
// are client components, so this stays plain zod (see `shipping-query.ts`).
//
// The name is the provinces table's unique key, so it is normalized — here, via
// the schema's transform, and again by the DAO on every write so no caller can
// bypass it — and the unique constraint is then the real duplicate backstop:
// «كرمان» (Arabic kaf) and «کرمان» become one string before either reaches it.
import { z } from 'zod';
import { foldPersianLetters } from '@/lib/catalog/search-text';
import { toPersianDigits } from '@/lib/format';
import { FORBIDDEN_TEXT_CHARS, VISIBLE_CHAR } from '@/lib/validation/text';
import { SHIPPING_FEE_MESSAGE, shippingFeeSchema } from './shipping-query';

/** The longest province name accepted, after trimming. The longest real one is 19. */
export const PROVINCE_NAME_MAX_LENGTH = 60;

/** Persian, user-facing — these strings surface on the admin form's fields. */
export const PROVINCE_MESSAGES = {
  name: 'نام استان الزامی است.',
  nameLength: `نام استان حداکثر ${toPersianDigits(PROVINCE_NAME_MAX_LENGTH)} نویسه است.`,
  nameChars: 'نام استان نویسه\u200Cهای نامعتبر دارد.',
  fee: SHIPPING_FEE_MESSAGE,
};

/** Shown where a saved address points at a province the shop no longer serves. */
export const STALE_PROVINCE_MESSAGE =
  'این استان دیگر پشتیبانی نمی\u200Cشود، استان دیگری انتخاب کن';

/**
 * Every invisible character except ZWNJ: the format characters (`\p{Cf}`: ZWSP,
 * ZWJ, word joiner, soft hyphen, LRM/RLM/ALM, …), every default-ignorable code
 * point (the combining grapheme joiner U+034F, variation selectors, Mongolian
 * FVS, the Hangul fillers U+115F/U+1160/U+3164/U+FFA0 — letters by category, so
 * they pass `VISIBLE_CHAR`), and the blank braille pattern U+2800 (a symbol that
 * renders as nothing). Each would otherwise make a second, visually identical
 * province. Lookahead instead of a `v`-flag set difference: the target is ES2022.
 */
const INVISIBLE_EXCEPT_ZWNJ =
  /(?!\u200C)[\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/gu;

/**
 * A province name in its one stored form: Arabic yeh/kaf folded to Persian,
 * invisible characters stripped, whitespace runs collapsed to one space, ends
 * trimmed. ZWNJ survives only inside a word — Persian needs it there — as a
 * single one; at either end or beside a space it only makes a look-alike, so it
 * goes. Idempotent, and linear (word-by-word, no backtracking lookaround). No
 * digit folding — a display name, not search text.
 *
 * It can normalize to empty (a name of Hangul fillers), so the schema checks
 * `VISIBLE_CHAR` on its OUTPUT, not on the raw input.
 */
export const normalizeProvinceName = (raw: string): string =>
  foldPersianLetters(raw)
    .replace(INVISIBLE_EXCEPT_ZWNJ, '')
    .split(/\s+/)
    .map((word) =>
      word.replace(/\u200C+/g, '\u200C').replace(/^\u200C|\u200C$/g, ''),
    )
    .filter(Boolean)
    .join(' ');

export const provinceCreateSchema = z.object({
  name: z
    .string({ error: PROVINCE_MESSAGES.name })
    .trim()
    .min(1, PROVINCE_MESSAGES.name)
    .max(PROVINCE_NAME_MAX_LENGTH, PROVINCE_MESSAGES.nameLength)
    .refine((value) => !FORBIDDEN_TEXT_CHARS.test(value), {
      error: PROVINCE_MESSAGES.nameChars,
    })
    .transform(normalizeProvinceName)
    // After the transform: a filler-only name passes VISIBLE_CHAR raw, then
    // normalizes to '' — which must never reach the insert.
    .refine((value) => VISIBLE_CHAR.test(value), {
      error: PROVINCE_MESSAGES.name,
    }),
  fee: shippingFeeSchema,
});

/** Deactivate / reactivate — the only field a province toggle may write. */
export const provinceToggleSchema = z.object({ isActive: z.boolean() });

export type ProvinceCreateBody = z.infer<typeof provinceCreateSchema>;
