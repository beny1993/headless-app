// Global test setup, loaded by vitest.config.ts for every suite.
import { beforeEach } from 'vitest';

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
beforeEach(() => {
  resetRateLimitBuckets();
});
