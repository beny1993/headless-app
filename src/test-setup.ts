// Global test setup, loaded by vitest.config.ts for every suite.
import { createHash } from 'node:crypto';
import { beforeEach } from 'vitest';

import { resetCache } from '@/lib/cache/store';
import { resetRateLimitBuckets } from '@/lib/hono/middleware/rate-limit-store';

// The `/api/*` rate limiter counts into a module-level Map, and every suite
// that drives the Hono app now spends from it — ten files, ~70 request sites.
// In the test environment Better Auth resolves them all to `127.0.0.1`, so they
// share one bucket per group. Counts are small today, but without this a suite
// that ever loops past a budget would fail with an unexplained 429 instead of
// an assertion, and the cause would not be visible in the failure.
//
// The import is the dependency-free store, never the middleware: importing
// `rate-limit.ts` here pulled better-auth and zod-openapi into every test file
// and cost the suite ~25s of setup.
//
// The storefront read cache (`src/lib/cache/store.ts`) is the same kind of
// state, on `globalThis`: one worker runs every suite, so a value one suite
// cached would answer another's read, and a test asserting "no DAO read before
// the guard" would pass on a warm entry.
beforeEach(() => {
  resetRateLimitBuckets();
  resetCache();
});

// `crypto.subtle.digest` hashes off the main thread here, so its promise
// settles a macrotask later — after the `act` a component test clicks in has
// flushed, and the checkout form's create (which waits on the digest of its
// Idempotency-Key's body, `checkout-key.ts`) would race the assertions. This
// stand-in returns the same SHA-256, computed on the spot, so it settles with
// the microtasks `act` does flush. Any other algorithm still goes to the real
// implementation.
const subtle = globalThis.crypto.subtle;
const digest = subtle.digest.bind(subtle);
subtle.digest = async (algorithm, data) => {
  if (algorithm !== 'SHA-256') return digest(algorithm, data);
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  return new Uint8Array(createHash('sha256').update(bytes).digest()).buffer;
};
