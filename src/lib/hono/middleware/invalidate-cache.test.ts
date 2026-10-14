import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_TAGS, cached } from '@/lib/cache/store';
import { invalidateOnWrite } from './invalidate-cache';

const { CATEGORIES, PRODUCTS } = CACHE_TAGS;
const opts = (tag: (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS]) => ({
  tags: [tag],
  ttlMs: 60_000,
});

/** Seeds a cached value and reports whether it is still the cached one. */
const seed = async (key: string, tag: Parameters<typeof opts>[0]) => {
  await cached(key, opts(tag), async () => 'cached');
  return async () =>
    (await cached(key, opts(tag), async () => 'fresh')) === 'cached';
};

const app = () => {
  const hono = new Hono();
  hono.use('/admin/categories/*', invalidateOnWrite(CATEGORIES));
  hono.all('/admin/categories', (c) => c.json({ ok: true }));
  hono.all('/admin/categories/:id', (c) =>
    c.req.param('id') === 'missing' ? c.json({}, 404) : c.json({ ok: true }),
  );
  hono.post('/admin/categories/:id/explode', () => {
    throw new Error('boom');
  });
  hono.onError((_error, c) => c.json({ error: true }, 500));
  return hono;
};

let stillCached: () => Promise<boolean>;
beforeEach(async () => {
  stillCached = await seed('categories', CATEGORIES);
});

describe('invalidateOnWrite', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'drops the tag after a %s',
    async (method) => {
      await app().request('/admin/categories/7', { method });
      expect(await stillCached()).toBe(false);
    },
  );

  it('covers the bare collection path, where a create lands', async () => {
    await app().request('/admin/categories', { method: 'POST' });
    expect(await stillCached()).toBe(false);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'leaves the cache alone on a %s',
    async (method) => {
      await app().request('/admin/categories/7', { method });
      expect(await stillCached()).toBe(true);
    },
  );

  it('drops it after a refused write too', async () => {
    await app().request('/admin/categories/missing', { method: 'PUT' });
    expect(await stillCached()).toBe(false);
  });

  it('drops it when the handler throws', async () => {
    const res = await app().request('/admin/categories/7/explode', {
      method: 'POST',
    });
    expect(res.status).toBe(500);
    expect(await stillCached()).toBe(false);
  });

  it('touches only its own tags', async () => {
    const productsCached = await seed('products', PRODUCTS);
    await app().request('/admin/categories/7', { method: 'PUT' });
    expect(await productsCached()).toBe(true);
  });

  it('does not run for a path outside its mount', async () => {
    const hono = app();
    hono.post('/elsewhere', (c) => c.json({}));
    await hono.request('/elsewhere', { method: 'POST' });
    expect(await stillCached()).toBe(true);
  });

  it('never runs when an earlier guard turns the caller away', async () => {
    const hono = new Hono();
    const guard = vi.fn(async (c) => c.json({}, 401));
    hono.use('/admin/*', guard);
    hono.use('/admin/categories/*', invalidateOnWrite(CATEGORIES));
    hono.put('/admin/categories/:id', (c) => c.json({}));

    const res = await hono.request('/admin/categories/7', { method: 'PUT' });
    expect(res.status).toBe(401);
    expect(await stillCached()).toBe(true);
  });
});
