// Persian text as the search index reads it — the one normalization both sides
// of the search go through: `ProductDao` runs it over a product's title, brand
// and benefit to fill `products.search_text` on every write, and runs it again
// over whatever the shopper typed before that term reaches the trigram index.
// Normalizing only one of the two would be worse than normalizing neither: the
// query and the column would disagree about which letters exist.
//
// **Nothing in this file may import drizzle, `pg` or `@hono/zod-openapi`** — the
// same rule as ./product-query.ts, and for the same reason: the shop's search
// box is a client component, so anything it can reach ends up in the browser
// bundle. This module is plain string work and imports nothing at all.
//
// Kept deliberately small. Every rule below exists because a shopper's keyboard
// or a supplier's product feed actually produces the character it fixes; there
// is no general-purpose Persian text pipeline here, and there should not be.

/**
 * Marks that carry no letter: the harakat (fathe, kasre, damme, tashdid,
 * sukun, tanvin…), the superscript alef, and tatweel — the decorative stretch
 * that pads «خــشک» out to fill a line. Suppliers paste all of them in;
 * nobody types them into a search box, and every one of them would split a
 * trigram that should have matched.
 */
const SILENT_MARKS = /[\u064B-\u0652\u0670\u0640]/g;

/** Arabic yeh and alef maksura, both of which Persian writes as ی. */
const ARABIC_YEH = /[يى]/g;
const PERSIAN_YEH = 'ی';

/** Arabic kaf, which Persian writes as ک. */
const ARABIC_KAF = /ك/g;
const PERSIAN_KEHEH = 'ک';

/** Arabic-Indic ٠١٢… and Persian ۰۱۲…, in that order — index modulo ten is the digit. */
const NON_ASCII_DIGITS = /[٠-٩۰-۹]/g;
const DIGIT_TABLE = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹';

/**
 * ZWNJ, ZWJ, zero-width space and the BOM.
 *
 * They become a **space** rather than being stripped, and that is the one
 * judgement call in this file. ZWNJ is a separator: Persian writes
 * «اسباب‌بازی», and the same shopper types «اسباب بازی» with a plain space
 * without thinking about it. Mapping it to a space makes those two the same
 * string, which is exactly the equivalence the search needs — and pg_trgm
 * already treats a space as a word boundary, so the trigrams line up. Stripping
 * it would instead glue the halves into «اسباب‌بازی» as one long token that a
 * space-typed query can never line up with.
 *
 * The other three are invisible clipboard debris with no separating job at all,
 * but they arrive in the same places, and a space there costs nothing once the
 * collapse below runs.
 */
// Escapes, not the characters themselves: they are invisible, so a literal
// class here is a range nobody can read, review or spot a typo in — and ESLint
// rejects irregular whitespace inside a regular expression for that reason.
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

/**
 * Arabic yeh/alef maksura → ی and Arabic kaf → ک, nothing else. Exported for
 * display names that need the same letter folding without the search-only rules
 * (digit folding, ZWNJ → space): `normalizeProvinceName` builds on it.
 */
export function foldPersianLetters(value: string): string {
  return value
    .replace(ARABIC_YEH, PERSIAN_YEH)
    .replace(ARABIC_KAF, PERSIAN_KEHEH);
}

/**
 * Product text and search terms, reduced to the form the trigram index holds.
 *
 * Idempotent — running it over already-normalized text returns that text — so a
 * re-seed, a second update, or a query typed straight from a normalized URL all
 * land on the same string.
 *
 * Case is deliberately *not* folded: pg_trgm lowercases when it extracts
 * trigrams (`'royal canin premium' %> 'ROYAL'` is true), so folding here would
 * buy no matches and would only make `search_text` a worse record of what the
 * product is actually called.
 */
export function normalizeSearchText(value: string): string {
  return foldPersianLetters(value.replace(SILENT_MARKS, ''))
    .replace(NON_ASCII_DIGITS, (digit) =>
      String(DIGIT_TABLE.indexOf(digit) % 10),
    )
    .replace(ZERO_WIDTH, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
