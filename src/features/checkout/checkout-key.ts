// The Idempotency-Keys checkout creates carry, one per request body.
// `createOrder` hands back the order a known key already made, whatever body
// comes with it, so a key is resent only with its own body: a create whose
// answer was lost, sent again as it was, gets that order back — also after a
// reload, since the keys are kept in `sessionStorage` — while a changed cart,
// address or method is a new checkout with a new key, and going back to the
// first body resends the first key.
//
// A body is kept as its SHA-256, never as itself, so no name, phone or address
// sits in storage. A key not sent for half an hour is dropped on the next read
// or write.
//
// Client-only. Every storage access is guarded: when storage throws, the
// form's in-memory copy carries the keys between retries, as it did before.
import { z } from 'zod';

/** Where the keys are kept; versioned so a changed shape is never misread. */
export const CHECKOUT_KEY_STORAGE = 'shop.checkout-keys.v1';

/** A key not sent for this long is not resent; its checkout is a new one. */
export const CHECKOUT_KEY_TTL_MS = 30 * 60 * 1000;

const keptKeySchema = z.object({
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  key: z.uuid(),
  at: z.number(),
});
export type KeptKey = z.infer<typeof keptKeySchema>;

const unexpired = (kept: readonly KeptKey[], now: number) =>
  kept.filter((entry) => now - entry.at < CHECKOUT_KEY_TTL_MS);

const writeStored = (kept: readonly KeptKey[]) => {
  try {
    if (kept.length > 0) {
      window.sessionStorage.setItem(CHECKOUT_KEY_STORAGE, JSON.stringify(kept));
    } else {
      window.sessionStorage.removeItem(CHECKOUT_KEY_STORAGE);
    }
  } catch {
    // memory keeps them
  }
};

/** The unexpired stored keys; what expired is dropped from storage too. */
const readStored = (now: number): KeptKey[] => {
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_KEY_STORAGE);
    if (!raw) return [];
    const parsed = z.array(keptKeySchema).safeParse(JSON.parse(raw));
    const kept = parsed.success ? unexpired(parsed.data, now) : [];
    if (!parsed.success || kept.length < parsed.data.length) writeStored(kept);
    return kept;
  } catch {
    return [];
  }
};

/** Hex SHA-256 of `body`: how a body is recognised without being kept. */
const digestOf = async (body: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');

/**
 * The key for a create of exactly `body` (the JSON sent): the one last sent
 * with this body under half an hour ago — from storage or from `memory`,
 * whichever holds it — else a fresh one. Either way it is kept, in both, as
 * sent now.
 */
export async function checkoutKeyFor(
  body: string,
  memory: { current: KeptKey[] },
): Promise<string> {
  const digest = await digestOf(body);
  const now = Date.now();
  const known = [...readStored(now), ...unexpired(memory.current, now)];
  const match = known
    .filter((entry) => entry.digest === digest)
    .sort((a, b) => b.at - a.at)[0];
  const sent: KeptKey = {
    digest,
    key: match?.key ?? crypto.randomUUID(),
    at: now,
  };
  // One entry per other body, the latest of storage's and memory's.
  const others = new Map<string, KeptKey>();
  for (const entry of known) {
    const seen = others.get(entry.digest);
    if (entry.digest !== digest && (!seen || seen.at < entry.at)) {
      others.set(entry.digest, entry);
    }
  }
  const kept = [...others.values(), sent];
  memory.current = kept;
  writeStored(kept);
  return sent.key;
}

/** Forgets `key`: its order exists, so the next checkout of that body is new. */
export function forgetCheckoutKey(key: string, memory: { current: KeptKey[] }) {
  const now = Date.now();
  memory.current = unexpired(memory.current, now).filter(
    (entry) => entry.key !== key,
  );
  writeStored(readStored(now).filter((entry) => entry.key !== key));
}

/** Forgets every kept key: at sign-out they stop being this shopper's. */
export function forgetCheckoutKeys() {
  try {
    window.sessionStorage.removeItem(CHECKOUT_KEY_STORAGE);
  } catch {
    // nothing kept there to forget
  }
}
