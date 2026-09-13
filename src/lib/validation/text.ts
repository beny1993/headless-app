// Shared text-field validators for the input contracts (checkout body, account
// pet/address forms). One definition so the null-byte gate — a real 500 the `pg`
// driver throws on a U+0000 inside a text parameter — is never hand-mirrored
// across boundaries (the repo's derive-not-mirror rule).
//
// **Nothing here may import drizzle, `pg` or `@hono/zod-openapi`** — these
// schemas ship in the browser bundle with the checkout and account forms. Plain
// zod only.
//
// The U+0000 target is CONSTRUCTED with `String.fromCharCode(0)`, never a literal
// control byte in the source (the project's control-character rule): a raw byte
// here would be invisible to review and to every diff.
import { z } from 'zod';

/**
 * Characters no free-text field may carry, as escapes (never typed): every
 * control character — NUL among them, which Postgres refuses as a 500 — and the
 * bidi embeddings, overrides and isolates (U+202A–U+202E, U+2066–U+2069), which
 * reorder the text around them wherever it is shown. ZWNJ is deliberately
 * allowed: Persian words need it. No `g` flag, so `.test` is stateless.
 */
export const FORBIDDEN_TEXT_CHARS = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;

/** At least one letter, digit, punctuation mark or symbol — `trim()` leaves ZWNJ. */
export const VISIBLE_CHAR = /[\p{L}\p{N}\p{P}\p{S}]/u;

/** The null byte, constructed — the `pg` driver 500s on one inside a text param. */
const NUL = String.fromCharCode(0);

/**
 * A required, length-bounded, null-byte-free text field. `.trim()` first so a
 * field of only whitespace fails `.min(1)` rather than storing blank; the refine
 * rejects U+0000, which would otherwise reach the `pg` driver and 500 on insert.
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
    .min(1, { message: 'این فیلد را وارد کن.' })
    .max(max, { message: 'مقدار واردشده بیش از حد طولانی است.' })
    .refine((value) => !value.includes(NUL), {
      message: 'مقدار واردشده نامعتبر است.',
    });

/**
 * The optional twin of {@link boundedText}: an absent field, or an empty string,
 * both become `undefined`; a present value is trimmed, capped and null-byte
 * checked. Empty-to-undefined is deliberate — a form posts `''` for a cleared
 * optional field (breed, age, weight, an address label), and that must store as
 * "no value", not as a blank string that later renders as an empty line.
 */
export const optionalBoundedText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: 'مقدار واردشده بیش از حد طولانی است.' })
    .refine((value) => !value.includes(NUL), {
      message: 'مقدار واردشده نامعتبر است.',
    })
    .transform((value) => (value === '' ? undefined : value))
    .optional();
