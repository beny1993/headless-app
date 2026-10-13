// Drops the storefront read cache (`src/lib/cache/store.ts`) after an admin
// write, so the next storefront render reads what the admin just saved.
//
// A middleware on the path rather than a call in each handler: every write the
// admin API has or will have under a path is covered by its one mount, and a
// handler added later cannot forget it. Mount it AFTER `requireAdmin`, so a
// caller the guard turns away never reaches it — an anonymous request must not
// be able to empty the cache over and over.
//
// It invalidates on every write the guard let through, whatever the answer: a
// refused save wrote nothing, and dropping a cache entry costs one read, while
// trusting the status would miss a write that committed before a later step
// failed.
import type { MiddlewareHandler } from 'hono';
import { type CacheTag, invalidateTags } from '@/lib/cache/store';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const invalidateOnWrite =
  (...tags: readonly CacheTag[]): MiddlewareHandler =>
  async (c, next) => {
    try {
      await next();
    } finally {
      if (!READS.has(c.req.method)) invalidateTags(...tags);
    }
  };
