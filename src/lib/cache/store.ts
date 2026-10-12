// The storefront's read cache: what only an admin changes (site content, the
// category list, shipping rates, the price-slider bounds, the sitemap's lists),
// kept in this process's memory and dropped by tag the moment an admin write
// lands (`invalidateOnWrite` in `src/lib/hono/middleware/invalidate-cache.ts`).
// `Story - Storefront Caching and Streaming`.
//
// Ours rather than Next's `unstable_cache`, for two reasons. A value comes back
// as the very object the loader returned — `unstable_cache` round-trips it
// through JSON, so every `Date` (`Category.createdAt`, the sitemap's
// `updatedAt`) would come back a string. And an invalidation is immediate: the
// next read loads fresh, where `revalidateTag(tag, 'max')` serves the stale
// value once more while it refreshes, and the admin would save a headline and
// still see the old one on the storefront.
//
// The state lives on `globalThis`, not in this module. `src/instrumentation.ts`
// runs in its own server layer with its own copy of every module, and a dev
// server re-evaluates modules on every edit; neither may end up holding a
// second, silently stale map.
//
// Imports nothing, so `src/test-setup.ts` can reset it before every test
// without loading a DAO — the same reason `rate-limit-store.ts` stands alone.
//
// ponytail: one container, one cache. A second container would keep its own
// and miss the other's invalidations; that is the day this needs a shared store.

/** What a cached read depends on; an admin write to that data drops it. */
export const CACHE_TAGS = {
  SITE_CONTENT: 'site-content',
  CATEGORIES: 'categories',
  PRODUCTS: 'products',
  SHIPPING: 'shipping',
} as const;
export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

type Entry = { value: unknown; expiresAt: number; tags: readonly CacheTag[] };
type Load = { promise: Promise<unknown>; tags: readonly CacheTag[] };

type CacheState = {
  entries: Map<string, Entry>;
  loads: Map<string, Load>;
  /** Bumped by every invalidation, so a load that started before one is not kept. */
  generations: Map<CacheTag, number>;
};

const STATE = Symbol.for('smokey-shop.read-cache');
const scope = globalThis as typeof globalThis & { [STATE]?: CacheState };

const freshState = (): CacheState => ({
  entries: new Map(),
  loads: new Map(),
  generations: new Map(),
});

// In development a module re-evaluates when its file is edited, and a loader
// that changed must not keep serving what the old one cached. Production
// evaluates once per layer, and there the instrumentation layer must not wipe
// what the pages' layer already holds.
if (!scope[STATE] || process.env.NODE_ENV !== 'production') {
  scope[STATE] = freshState();
}
const state = (): CacheState => (scope[STATE] ??= freshState());

const generationOf = (tags: readonly CacheTag[]) =>
  tags.map((tag) => state().generations.get(tag) ?? 0).join(',');

/**
 * `loader`'s value for `key`, from memory while it is younger than `ttlMs` and
 * none of `tags` has been invalidated since it loaded. Concurrent first reads
 * share one load; a load that throws is not kept, so the next read retries.
 *
 * The value is shared by every caller until it expires: never mutate it.
 */
export function cached<T>(
  key: string,
  { tags, ttlMs }: { tags: readonly CacheTag[]; ttlMs: number },
  loader: () => Promise<T>,
): Promise<T> {
  const { entries, loads } = state();
  const entry = entries.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return Promise.resolve(entry.value as T);
  }
  const running = loads.get(key);
  if (running) return running.promise as Promise<T>;

  const generation = generationOf(tags);
  const promise = loader().then(
    (value) => {
      if (loads.get(key)?.promise === promise) loads.delete(key);
      // A save that landed while this was loading may have been read too late:
      // hand the value to whoever asked, but do not keep it.
      if (generationOf(tags) === generation) {
        entries.set(key, { value, expiresAt: Date.now() + ttlMs, tags });
      }
      return value;
    },
    (error: unknown) => {
      if (loads.get(key)?.promise === promise) loads.delete(key);
      throw error;
    },
  );
  loads.set(key, { promise, tags });
  return promise;
}

/** Drops every value, and every load in flight, that depends on any of `tags`. */
export function invalidateTags(...tags: readonly CacheTag[]): void {
  const { entries, loads, generations } = state();
  for (const tag of tags) generations.set(tag, (generations.get(tag) ?? 0) + 1);
  const hit = (dependsOn: readonly CacheTag[]) =>
    dependsOn.some((tag) => tags.includes(tag));
  for (const [key, entry] of entries) if (hit(entry.tags)) entries.delete(key);
  for (const [key, load] of loads) if (hit(load.tags)) loads.delete(key);
}

/** Empties the cache. For `src/test-setup.ts`: one worker runs every suite. */
export function resetCache(): void {
  scope[STATE] = freshState();
}
