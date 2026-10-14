import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_TAGS, cached, invalidateTags, resetCache } from './store';

const { SITE_CONTENT, CATEGORIES, PRODUCTS } = CACHE_TAGS;
const MINUTE = 60_000;

/** A loader that answers 1, 2, 3… and counts its calls. */
const counter = () => {
  let calls = 0;
  const load = vi.fn(async () => ++calls);
  return load;
};

/** A promise this test settles by hand. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => resetCache());

describe('cached', () => {
  it('loads once and answers later reads from memory', async () => {
    const load = counter();
    const opts = { tags: [CATEGORIES], ttlMs: MINUTE };

    expect(await cached('k', opts, load)).toBe(1);
    expect(await cached('k', opts, load)).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('hands back the very object the loader returned, Dates intact', async () => {
    const row = { createdAt: new Date('2026-10-12T00:00:00Z') };
    const opts = { tags: [CATEGORIES], ttlMs: MINUTE };

    await cached('k', opts, async () => row);
    const again = await cached('k', opts, async () => ({ createdAt: 'x' }));

    expect(again).toBe(row);
    expect(again.createdAt).toBeInstanceOf(Date);
  });

  it('keeps separate keys apart', async () => {
    const opts = { tags: [CATEGORIES], ttlMs: MINUTE };

    expect(await cached('a', opts, async () => 'A')).toBe('A');
    expect(await cached('b', opts, async () => 'B')).toBe('B');
  });

  describe('expiry', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
    afterEach(() => vi.useRealTimers());

    it('reloads once the value is older than its ttl, not before', async () => {
      const load = counter();
      const opts = { tags: [CATEGORIES], ttlMs: MINUTE };

      await cached('k', opts, load);
      vi.advanceTimersByTime(MINUTE - 1);
      expect(await cached('k', opts, load)).toBe(1);
      vi.advanceTimersByTime(1);
      expect(await cached('k', opts, load)).toBe(2);
    });

    it('reloads every time with a zero ttl', async () => {
      const load = counter();
      const opts = { tags: [CATEGORIES], ttlMs: 0 };

      await cached('k', opts, load);
      await cached('k', opts, load);
      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  it('shares one load between concurrent first reads', async () => {
    const gate = deferred<string>();
    const load = vi.fn(() => gate.promise);
    const opts = { tags: [CATEGORIES], ttlMs: MINUTE };

    const first = cached('k', opts, load);
    const second = cached('k', opts, load);
    gate.resolve('v');

    expect(await Promise.all([first, second])).toEqual(['v', 'v']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps nothing from a load that throws, so the next read retries', async () => {
    const opts = { tags: [CATEGORIES], ttlMs: MINUTE };
    const boom = new Error('db down');

    await expect(cached('k', opts, () => Promise.reject(boom))).rejects.toBe(
      boom,
    );
    expect(await cached('k', opts, async () => 'ok')).toBe('ok');
  });

  it('hands one rejection to every concurrent reader of a failing load', async () => {
    const gate = deferred<string>();
    const opts = { tags: [CATEGORIES], ttlMs: MINUTE };

    const first = cached('k', opts, () => gate.promise);
    const second = cached('k', opts, async () => 'never asked');
    gate.reject(new Error('db down'));

    await expect(first).rejects.toThrow('db down');
    await expect(second).rejects.toThrow('db down');
  });
});

describe('invalidateTags', () => {
  it('drops every value carrying the tag and leaves the rest', async () => {
    const content = counter();
    const both = counter();
    const products = counter();

    await cached('content', { tags: [SITE_CONTENT], ttlMs: MINUTE }, content);
    await cached(
      'both',
      { tags: [SITE_CONTENT, PRODUCTS], ttlMs: MINUTE },
      both,
    );
    await cached('products', { tags: [PRODUCTS], ttlMs: MINUTE }, products);

    invalidateTags(SITE_CONTENT);

    expect(
      await cached('content', { tags: [SITE_CONTENT], ttlMs: MINUTE }, content),
    ).toBe(2);
    expect(
      await cached(
        'both',
        { tags: [SITE_CONTENT, PRODUCTS], ttlMs: MINUTE },
        both,
      ),
    ).toBe(2);
    expect(
      await cached('products', { tags: [PRODUCTS], ttlMs: MINUTE }, products),
    ).toBe(1);
  });

  it('takes several tags at once', async () => {
    const a = counter();
    const b = counter();

    await cached('a', { tags: [CATEGORIES], ttlMs: MINUTE }, a);
    await cached('b', { tags: [PRODUCTS], ttlMs: MINUTE }, b);
    invalidateTags(CATEGORIES, PRODUCTS);

    expect(await cached('a', { tags: [CATEGORIES], ttlMs: MINUTE }, a)).toBe(2);
    expect(await cached('b', { tags: [PRODUCTS], ttlMs: MINUTE }, b)).toBe(2);
  });

  it('does not keep a load that was in flight when its tag was invalidated', async () => {
    // The load read the old row; the save landed before it returned. Its
    // value still answers the reader who asked, but must not be cached.
    const gate = deferred<string>();
    const opts = { tags: [SITE_CONTENT], ttlMs: MINUTE };

    const stale = cached('k', opts, () => gate.promise);
    invalidateTags(SITE_CONTENT);
    gate.resolve('old');

    expect(await stale).toBe('old');
    expect(await cached('k', opts, async () => 'new')).toBe('new');
  });

  it('starts a fresh load for a reader arriving after the invalidation', async () => {
    const gate = deferred<string>();
    const opts = { tags: [SITE_CONTENT], ttlMs: MINUTE };

    const before = cached('k', opts, () => gate.promise);
    invalidateTags(SITE_CONTENT);
    const after = cached('k', opts, async () => 'new');
    gate.resolve('old');

    expect(await before).toBe('old');
    expect(await after).toBe('new');
    expect(await cached('k', opts, async () => 'later')).toBe('new');
  });

  it('keeps an in-flight load whose tags were not invalidated', async () => {
    const gate = deferred<string>();
    const opts = { tags: [PRODUCTS], ttlMs: MINUTE };

    const loading = cached('k', opts, () => gate.promise);
    invalidateTags(SITE_CONTENT);
    gate.resolve('v');

    expect(await loading).toBe('v');
    expect(await cached('k', opts, async () => 'other')).toBe('v');
  });

  it('is harmless on an empty cache', () => {
    expect(() => invalidateTags(CATEGORIES)).not.toThrow();
  });
});

describe('shared state', () => {
  it('lives on globalThis, so a second copy of the module sees the same cache', async () => {
    await cached('k', { tags: [CATEGORIES], ttlMs: MINUTE }, async () => 'one');
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const copy = await import('./store');
      expect(
        await copy.cached(
          'k',
          { tags: [CATEGORIES], ttlMs: MINUTE },
          async () => 'two',
        ),
      ).toBe('one');
      copy.invalidateTags(CATEGORIES);
      expect(
        await cached(
          'k',
          { tags: [CATEGORIES], ttlMs: MINUTE },
          async () => 'three',
        ),
      ).toBe('three');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('starts empty when a development server re-evaluates the module', async () => {
    await cached(
      'k',
      { tags: [CATEGORIES], ttlMs: MINUTE },
      async () => 'old loader',
    );
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    try {
      const copy = await import('./store');
      expect(
        await copy.cached(
          'k',
          { tags: [CATEGORIES], ttlMs: MINUTE },
          async () => 'new loader',
        ),
      ).toBe('new loader');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('resetCache empties it', async () => {
    const load = counter();
    await cached('k', { tags: [CATEGORIES], ttlMs: MINUTE }, load);
    resetCache();
    expect(await cached('k', { tags: [CATEGORIES], ttlMs: MINUTE }, load)).toBe(
      2,
    );
  });
});
