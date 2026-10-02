// The Idempotency-Key a checkout create carries, kept with the exact request
// body it was minted for. `createOrder` hands back the order a known key
// already made, whatever body comes with it, so a key is resent only with its
// own body: a create whose answer was lost, sent again as it was, gets that
// order back — also after a reload, since the key is kept in `sessionStorage`
// — while a changed cart, address or method is a new checkout with a new key.
//
// Client-only. Every storage access is guarded: when storage throws, the
// form's in-memory copy carries the key between retries, as it did before.
import { z } from 'zod';

/** Where the key is kept; versioned so a changed shape is never misread. */
export const CHECKOUT_KEY_STORAGE = 'smokey.checkout-key.v1';

/** A kept key older than this is not resent; its checkout is a new one. */
export const CHECKOUT_KEY_TTL_MS = 30 * 60 * 1000;

const keptKeySchema = z.object({
  key: z.uuid(),
  body: z.string(),
  at: z.number(),
});
export type KeptKey = z.infer<typeof keptKeySchema>;

const readKept = (): KeptKey | null => {
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_KEY_STORAGE);
    if (!raw) return null;
    const kept = keptKeySchema.safeParse(JSON.parse(raw));
    return kept.success ? kept.data : null;
  } catch {
    return null;
  }
};

/**
 * The key for a create of exactly `body` (the JSON sent): the kept one — from
 * storage, else from `memory` — if it was minted for this body under half an
 * hour ago, else a fresh one, kept in both.
 */
export function checkoutKeyFor(
  body: string,
  memory: { current: KeptKey | null },
): string {
  const now = Date.now();
  const kept = readKept() ?? memory.current;
  if (kept && kept.body === body && now - kept.at < CHECKOUT_KEY_TTL_MS) {
    return kept.key;
  }
  const fresh: KeptKey = { key: crypto.randomUUID(), body, at: now };
  memory.current = fresh;
  try {
    window.sessionStorage.setItem(CHECKOUT_KEY_STORAGE, JSON.stringify(fresh));
  } catch {
    // memory keeps it
  }
  return fresh.key;
}

/** Forgets the kept key: its order exists, so the next checkout is a new one. */
export function forgetCheckoutKey(memory: { current: KeptKey | null }) {
  memory.current = null;
  try {
    window.sessionStorage.removeItem(CHECKOUT_KEY_STORAGE);
  } catch {
    // nothing kept there to forget
  }
}
