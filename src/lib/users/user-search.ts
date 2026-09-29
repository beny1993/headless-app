// The admin users list's search box: what `?q=` may carry, and what kind of
// search it is. Client-safe (plain zod, no DB): the page bounds its input with
// the same constant the schema checks, and `UserDao.pageForAdmin` turns the
// classification into SQL.
import { normalizeIranPhone } from '@/lib/auth/phone';
import { toAsciiDigits } from '@/lib/format';
import { boundedText } from '@/lib/validation/text';

/** Longest `q` the list searches by; the input's `maxLength` is this too. */
export const MAX_USER_SEARCH_LENGTH = 100;

/**
 * A present search term: trimmed, non-blank, bounded, and free of NUL (which
 * would 500 in `pg`) and bidi controls. The page adds `.optional().catch()`, so
 * anything else reads as no search at all.
 */
export const userSearchSchema = boundedText(MAX_USER_SEARCH_LENGTH);

/** How one search term is matched against the users table. */
export type UserSearch =
  /** A whole number, in any spelling: exact match on the canonical form. */
  | { by: 'phone'; phone: string }
  /** The start of a local `0…` number: prefix match on `+98…`. */
  | { by: 'phonePrefix'; prefix: string }
  /** Anything else: a case-insensitive substring of the name. */
  | { by: 'name'; text: string };

const LOCAL_PARTIAL = /^0\d*$/;

/** The separators a grouped number is written with: `0912 123`, `(0912)-123`. */
const SEPARATORS = /[ ()-]/g;

/**
 * A term the admin typed → how to search for it. A number that normalizes is a
 * phone (`09…`, `+98…`, `0098…`, Persian digits). A digit run starting with `0`
 * is the start of a local number, grouped or not. Anything else, a bare `912…`
 * included, is a name fragment (Benyamin, 2026-09-29).
 */
export function classifyUserSearch(q: string): UserSearch {
  const phone = normalizeIranPhone(q);
  if (phone) return { by: 'phone', phone };

  const digits = toAsciiDigits(q).replace(SEPARATORS, '');
  if (LOCAL_PARTIAL.test(digits)) {
    return { by: 'phonePrefix', prefix: `+98${digits.slice(1)}` };
  }
  return { by: 'name', text: q };
}
