// Shared text-field validators for the input contracts (checkout body, account
// address form). One definition so the null-byte gate — a real 500 the `pg`
// driver throws on a U+0000 inside a text parameter — is never hand-mirrored
// across boundaries (the repo's derive-not-mirror rule).
//
// **Nothing here may import drizzle, `pg` or `@hono/zod-openapi`** — these
// schemas ship in the browser bundle with the checkout and account forms. Plain
// zod only.
//
// Every character the class names is written as a `\uXXXX` ESCAPE, never as the
// literal byte (the project's control-character rule): a raw one here would be
// invisible to review and to every diff. Tests construct theirs with
// `String.fromCharCode`.
import { z } from 'zod';

/**
 * Characters no free-text field may carry, as escapes (never typed): every
 * control character — NUL among them, which Postgres refuses as a 500 — and the
 * whole bidi-formatting family: the embeddings, overrides and isolates
 * (U+202A–U+202E, U+2066–U+2069), the three marks (U+061C ALM, U+200E LRM,
 * U+200F RLM) and the two separators (U+2028 LS, U+2029 PS). A mark carries no
 * embedding to pop, but one still reorders the neutral characters beside it
 * — a price, a phone number or a bracket then renders somewhere it was never
 * typed. A paragraph separator goes further and resets the base direction of
 * everything after it; both are Zl/Zp, so `\p{Cc}` never covered them.
 * ZWNJ (U+200C) stays allowed, one code point from LRM: Persian words need it.
 * No `g` flag, so `.test` is stateless.
 */
export const FORBIDDEN_TEXT_CHARS =
  /[\p{Cc}\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;

/**
 * The class as a predicate. `multiline` lets tab, line feed and carriage return
 * through — they are `\p{Cc}` members that a textarea legitimately produces, and
 * an address line and a product description are textareas.
 *
 * Every shared validator below uses the multiline form. Single-line fields keep
 * accepting a newline exactly as they did before this guard existed; tightening
 * them is a separate decision from closing the bidi hole.
 */
export const hasNoForbiddenChars = (multiline: boolean) => (value: string) =>
  !FORBIDDEN_TEXT_CHARS.test(
    multiline ? value.replace(/[\t\n\r]/g, '') : value,
  );

/** At least one letter, digit, punctuation mark or symbol — `trim()` leaves ZWNJ. */
export const VISIBLE_CHAR = /[\p{L}\p{N}\p{P}\p{S}]/u;

/**
 * A required, length-bounded text field, free of forbidden characters. `.trim()`
 * first so a field of only whitespace fails `.min(1)` rather than storing blank.
 *
 * The refine covers U+0000, which would otherwise reach the `pg` driver and 500
 * on insert (it is a `\p{Cc}` member), and the bidi family — a right-to-left
 * override in a recipient name would reorder the admin's own order screen.
 *
 * The Persian messages are surfaced verbatim in the checkout/account forms (via
 * `formatZodIssues` → `parseFieldErrors`), so they must be Persian to satisfy the
 * per-field-error requirement — and digit-free, since a raw `${max}` would render
 * as an ASCII numeral on an RTL page.
 */
export const boundedText = (max: number) =>
  z
    .string()
    .trim()
    .min(1, { error: 'این فیلد را وارد کن.' })
    .max(max, { error: 'مقدار واردشده بیش از حد طولانی است.' })
    .refine(hasNoForbiddenChars(true), {
      error: 'مقدار واردشده نامعتبر است.',
    });

/**
 * {@link boundedText} that may be blank: trimmed, capped and character checked,
 * but `''` is a value — for a fixed slot that is simply unused (a content
 * block's spare bank card), where the stored row, the code default and the
 * editor's own empty field must all read the same.
 */
export const blankableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'مقدار واردشده بیش از حد طولانی است.' })
    .refine(hasNoForbiddenChars(true), {
      error: 'مقدار واردشده نامعتبر است.',
    });

/**
 * The optional twin of {@link boundedText}: an absent field, or an empty string,
 * both become `undefined`; a present value is trimmed, capped and character
 * checked. Empty-to-undefined is deliberate — a form posts `''` for a cleared
 * optional field (breed, age, weight, an address label), and that must store as
 * "no value", not as a blank string that later renders as an empty line.
 */
export const optionalBoundedText = (max: number) =>
  blankableText(max)
    .transform((value) => (value === '' ? undefined : value))
    .optional();
