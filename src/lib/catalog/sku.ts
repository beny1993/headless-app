// The product SKU, derived — never typed. The create route builds it from the
// slug the admin already enters plus a short random suffix, so it reads like the
// product (`ROYAL-CANIN-SENSIBLE-2KG-7K3Q`) and does not clash even when a
// renamed slug is later reused. It is set once: an update never touches it,
// because it is snapshotted onto order items.
//
// Client-safe (no drizzle, `pg` or `@hono/zod-openapi`): the product form
// imports `skuPreview` to show the derived part before the server adds the
// random suffix.

/** `products.sku`'s cap — the longest SKU this module produces. */
export const MAX_SKU_LENGTH = 64;

/** Random characters appended after the slug. */
export const SKU_SUFFIX_LENGTH = 4;

/** The longest slug whose SKU (slug, dash, suffix) still fits `MAX_SKU_LENGTH`. */
export const MAX_SLUG_LENGTH = MAX_SKU_LENGTH - 1 - SKU_SUFFIX_LENGTH;

/**
 * 32 characters without the look-alikes 0/O and 1/I. 256 is a multiple of 32,
 * so `byte % 32` picks each one with equal odds.
 */
export const SKU_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const skuPrefix = (slug: string) => slug.trim().toUpperCase();

const cryptoBytes = (length: number) =>
  crypto.getRandomValues(new Uint8Array(length));

/**
 * The SKU for a new product: the upper-cased slug, a dash, and a random suffix.
 * `randomBytes` is injectable so tests are deterministic.
 */
// ponytail: no retry on a clash. The slug is unique and the suffix has 32^4
// (about a million) values, so a collision needs a reused slug AND a matching
// suffix; the unique constraint still refuses it as a 400. Add a retry if that
// ever fires.
export function generateSku(
  slug: string,
  randomBytes: (length: number) => Uint8Array = cryptoBytes,
): string {
  const suffix = Array.from(
    randomBytes(SKU_SUFFIX_LENGTH),
    (byte) => SKU_ALPHABET[byte % SKU_ALPHABET.length],
  ).join('');
  return `${skuPrefix(slug)}-${suffix}`;
}

/** What the form shows before saving: the derived part and a placeholder suffix. */
export function skuPreview(slug: string): string {
  const prefix = skuPrefix(slug);
  return prefix ? `${prefix}-${'?'.repeat(SKU_SUFFIX_LENGTH)}` : '';
}
