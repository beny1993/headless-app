// Iranian mobile numbers, reduced to one canonical form.
//
// **Nothing in this file may import drizzle, `pg` or `@hono/zod-openapi`** — the
// login form is a client component and imports the schema below, so anything
// reachable from here ends up in the browser bundle. Same rule, same reason, as
// `src/lib/catalog/product-query.ts`.
//
// ## Canonical form: `+989121234567`
//
// E.164: a literal `+98`, then the ten-digit national number starting with `9`.
// That is what `user.phone_number` stores, what `otp_send_log` is keyed by, and
// the *only* shape the auth API accepts — see `phoneNumberValidator` in
// ./index.ts. The alternative, accepting whatever the caller sent and
// normalizing on the way in, is how one human ends up with two accounts:
// `09121234567` and `+989121234567` are different strings, and a unique index
// cannot see that they are the same person.
import * as z from 'zod';
import { normalizeSearchText } from '@/lib/catalog/search-text';

/**
 * Everything a phone number may be written with, before normalization: ASCII,
 * Persian (۰۹) and Arabic-Indic (٠٩) digits, the separators a contact card or a
 * shopper actually produces, and a single leading `+`.
 *
 * An allowlist rather than a strip-what-we-dislike pass, and it runs on the raw
 * input *before* any folding. Invisible characters — ZWNJ, NBSP, bidi controls,
 * a NUL byte — have no meaning inside a phone number, so they are rejected
 * outright instead of being quietly deleted or turned into a separator. At an
 * auth boundary, "I do not understand this input" is a better answer than a
 * guess at what the user meant.
 */
const WRITABLE_PHONE = /^\+?[0-9۰-۹٠-٩ ()-]+$/;

/** Separators, once the allowlist above has vouched for the whole string. */
const SEPARATORS = /[ ()-]/g;

/**
 * Longer than any legal way of writing one of these numbers
 * (`0098 912 123 4567` is 17). A cap before the work, so a megabyte of digits
 * posted at the login endpoint costs a length check and nothing else.
 */
export const MAX_PHONE_INPUT_LENGTH = 32;

/** The national number itself: an Iranian mobile is `9` plus nine digits. */
const NATIONAL_MOBILE = /^9\d{9}$/;

const COUNTRY_CODE = '98';

/** The placeholder and hint the login form shows, in the shape shoppers know. */
export const CANONICAL_PHONE_EXAMPLE = '09121234567';

/** One message for every rejection: a specific one would enumerate the rules. */
export const INVALID_PHONE_MESSAGE =
  'شماره موبایل معتبر نیست. مثال: ۰۹۱۲۱۲۳۴۵۶۷';

/**
 * Any way of writing an Iranian mobile number → `+989xxxxxxxxx`, or `null`.
 *
 * Idempotent: canonical input returns itself, so re-normalizing a stored number
 * is a no-op. Never throws and never guesses — a landline, a foreign number or
 * a wrong-length string is `null`, not a best effort.
 */
export function normalizeIranPhone(input: string): string | null {
  if (typeof input !== 'string' || input.length > MAX_PHONE_INPUT_LENGTH) {
    return null;
  }
  if (!WRITABLE_PHONE.test(input)) return null;

  // The repo's shared Persian-input normalizer folds ۰۹ and ٠٩ to ASCII. Its
  // other rules (ZWNJ, silent marks, yeh/kaf) cannot fire here: the allowlist
  // above has already rejected every character it would touch. Reusing it keeps
  // one digit table in the codebase — and the digit cases in this file's tests
  // are what would catch it drifting.
  const digits = normalizeSearchText(input).replace(SEPARATORS, '');

  // Strip whichever way the caller wrote "dial internationally", then decide
  // what is left by its length. `+` and `00` are the same instruction.
  let rest = digits;
  if (rest.startsWith('+')) rest = rest.slice(1);
  else if (rest.startsWith('00')) rest = rest.slice(2);

  let national: string;
  if (rest.length === 12 && rest.startsWith(COUNTRY_CODE)) {
    national = rest.slice(COUNTRY_CODE.length);
  } else if (rest.length === 11 && rest.startsWith('0')) {
    national = rest.slice(1);
  } else if (rest.length === 10) {
    national = rest;
  } else {
    return null;
  }

  if (!NATIONAL_MOBILE.test(national)) return null;
  return `+${COUNTRY_CODE}${national}`;
}

/**
 * The zod boundary every external phone input crosses — the login form, the
 * API, `pnpm create-admin`. Parses *to* the canonical form, so a caller that
 * has parsed cannot then send the raw string by accident.
 */
export const iranMobileSchema = z
  .string({ error: INVALID_PHONE_MESSAGE })
  .max(MAX_PHONE_INPUT_LENGTH, { error: INVALID_PHONE_MESSAGE })
  .transform((value, ctx) => {
    const canonical = normalizeIranPhone(value);
    if (canonical === null) {
      ctx.addIssue({ code: 'custom', message: INVALID_PHONE_MESSAGE });
      return z.NEVER;
    }
    return canonical;
  });

/**
 * Canonical storage → the `09…` form Iranians read and dial. Display only;
 * nothing is ever looked up or stored by this. Anything that is not canonical
 * comes back untouched rather than being reshaped on a guess.
 */
export function toLocalIranPhone(phoneNumber: string): string {
  const prefix = `+${COUNTRY_CODE}`;
  return phoneNumber.startsWith(prefix)
    ? `0${phoneNumber.slice(prefix.length)}`
    : phoneNumber;
}
