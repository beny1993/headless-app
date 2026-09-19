// The rate limiter's mutable state, kept in its own module for ONE reason: it
// imports nothing.
//
// `src/test-setup.ts` resets this before every test, because the counter is
// module state that every suite driving the Hono app spends from. Importing
// `rate-limit.ts` there instead would pull `better-auth/api` and
// `@hono/zod-openapi` into all 154 test files — measured at ~25s of setup per
// `pnpm test`. This module costs nothing to load.

/**
 * A sliding-window counter: `previous` is the last window's count, carried
 * forward and weighted by how much of it still overlaps the current window.
 */
export type Bucket = { windowStart: number; current: number; previous: number };

/** All mutable limiter state, so one reset covers it. */
export const rateLimitState = {
  buckets: new Map<string, Bucket>(),
  nextPruneAt: 0,
  sharedBucketWarned: false,
};

/** Live bucket count — for the test that proves the map stays bounded. */
export const bucketCount = () => rateLimitState.buckets.size;

/** Drops every counter and re-arms the one-time shared-bucket warning. */
export const resetRateLimitBuckets = () => {
  rateLimitState.buckets.clear();
  rateLimitState.nextPruneAt = 0;
  rateLimitState.sharedBucketWarned = false;
};
