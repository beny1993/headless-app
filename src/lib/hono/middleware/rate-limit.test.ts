import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_PATHS, checkoutFailurePath } from '@/lib/constant/paths';

import {
  MAX_RATE_LIMIT_BUCKETS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMITS,
  resetRateLimitBuckets,
  bucketCount,
  rateLimit,
  rateLimitGroupFor,
} from './rate-limit';

/** A throwaway app with the limiter mounted exactly as the real one mounts it. */
const makeApp = () => {
  const app = new Hono();
  app.use('*', rateLimit);
  app.all('*', (c) => c.text('ok'));
  return app;
};

/** One request from `ip`, with the CF header trusted (the flag is on below). */
const hit = (app: Hono, path: string, ip: string) =>
  app.request(path, { headers: { 'cf-connecting-ip': ip } });

let nextIp = 0;
/** A fresh address per test, so buckets never leak between cases. */
const freshIp = () =>
  `10.99.${Math.floor(nextIp / 250)}.${(nextIp++ % 250) + 1}`;

beforeEach(() => {
  vi.stubEnv('APP_CONFIG_TRUST_CF_HEADER', 'true');
  resetRateLimitBuckets();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('rateLimitGroupFor', () => {
  it.each([
    [API_PATHS.PRODUCTS, 'catalog'],
    [`${API_PATHS.PRODUCTS}/some-slug`, 'catalog'],
    [API_PATHS.CATEGORIES, 'catalog'],
    [API_PATHS.PAYMENT_CALLBACK, 'paymentCallback'],
    [API_PATHS.CHECKOUT_PREVIEW, 'checkoutPreview'],
    [API_PATHS.ADMIN_PRODUCTS, 'admin'],
    [`${API_PATHS.SHIPPING_RATES}/3`, 'admin'],
    [API_PATHS.PAYMENT_RECONCILE, 'admin'],
    [API_PATHS.CHECKOUT, 'default'],
    [API_PATHS.SHIPPING_RATES, 'default'],
    [API_PATHS.ME_ORDERS, 'default'],
  ])('%s → %s', (path, group) => {
    expect(rateLimitGroupFor(path)).toBe(group);
  });

  it('exempts the liveness and readiness probes', () => {
    // A counted probe marks the container unhealthy and rolls the deploy back.
    expect(rateLimitGroupFor(API_PATHS.HEALTH)).toBeNull();
    expect(rateLimitGroupFor(API_PATHS.READY)).toBeNull();
  });

  it('does not mistake the public rates read for the admin write path', () => {
    // Method-agnostic matching: the trailing segment is what separates them.
    expect(rateLimitGroupFor(API_PATHS.SHIPPING_RATES)).not.toBe('admin');
    expect(rateLimitGroupFor(`${API_PATHS.SHIPPING_RATES}/12`)).toBe('admin');
  });
});

describe('budgets', () => {
  it('lets a caller through up to its budget', async () => {
    const app = makeApp();
    const ip = freshIp();

    for (let i = 0; i < RATE_LIMITS.checkoutPreview; i++) {
      const res = await hit(app, API_PATHS.CHECKOUT_PREVIEW, ip);
      expect(res.status).toBe(200);
    }
  });

  it('refuses the next one with 429, the envelope and Retry-After', async () => {
    const app = makeApp();
    const ip = freshIp();

    for (let i = 0; i < RATE_LIMITS.checkoutPreview; i++) {
      await hit(app, API_PATHS.CHECKOUT_PREVIEW, ip);
    }
    const res = await hit(app, API_PATHS.CHECKOUT_PREVIEW, ip);

    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
  });

  it('gives two callers independent budgets', async () => {
    const app = makeApp();
    const spender = freshIp();
    const bystander = freshIp();

    for (let i = 0; i <= RATE_LIMITS.checkoutPreview; i++) {
      await hit(app, API_PATHS.CHECKOUT_PREVIEW, spender);
    }

    expect((await hit(app, API_PATHS.CHECKOUT_PREVIEW, spender)).status).toBe(
      429,
    );
    expect((await hit(app, API_PATHS.CHECKOUT_PREVIEW, bystander)).status).toBe(
      200,
    );
  });

  it('keeps each group on its own budget', async () => {
    const app = makeApp();
    const ip = freshIp();

    // Spend the whole checkout-preview budget…
    for (let i = 0; i <= RATE_LIMITS.checkoutPreview; i++) {
      await hit(app, API_PATHS.CHECKOUT_PREVIEW, ip);
    }
    expect((await hit(app, API_PATHS.CHECKOUT_PREVIEW, ip)).status).toBe(429);

    // …the catalogue is untouched. A flood on one route must not lock a
    // shopper out of checkout.
    expect((await hit(app, API_PATHS.PRODUCTS, ip)).status).toBe(200);
  });

  it('never counts the readiness probe', async () => {
    const app = makeApp();
    const ip = freshIp();

    for (let i = 0; i < RATE_LIMITS.default * 2; i++) {
      const res = await hit(app, API_PATHS.READY, ip);
      expect(res.status).toBe(200);
    }
  });
});

describe('the window rolls', () => {
  it('lets a throttled caller back in once their spend has aged out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const app = makeApp();
    const ip = freshIp();

    for (let i = 0; i <= RATE_LIMITS.checkoutPreview; i++) {
      await hit(app, API_PATHS.CHECKOUT_PREVIEW, ip);
    }
    expect((await hit(app, API_PATHS.CHECKOUT_PREVIEW, ip)).status).toBe(429);

    // Two windows, not one. Under a sliding counter the previous window's
    // spend is carried over and decays across the next one, so a caller who
    // burned a full budget is still (partly) paying for it one window later.
    // That is the intended behaviour — it is what removes the boundary burst.
    vi.advanceTimersByTime(RATE_LIMIT_WINDOW_MS * 2 + 1);

    expect((await hit(app, API_PATHS.CHECKOUT_PREVIEW, ip)).status).toBe(200);
  });

  it('recovers gradually rather than all at once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const app = makeApp();
    const ip = freshIp();
    const max = RATE_LIMITS.checkoutPreview;

    for (let i = 0; i < max; i++) {
      await hit(app, API_PATHS.CHECKOUT_PREVIEW, ip);
    }

    // Half a window on, roughly half the budget should be available again —
    // not zero (that would be a fixed window) and not all of it.
    vi.advanceTimersByTime(RATE_LIMIT_WINDOW_MS * 1.5);

    let allowed = 0;
    for (let i = 0; i < max; i++) {
      if ((await hit(app, API_PATHS.CHECKOUT_PREVIEW, ip)).status === 200) {
        allowed++;
      }
    }

    expect(allowed).toBeGreaterThan(0);
    expect(allowed).toBeLessThan(max);
  });

  it('does not admit a full second budget across the window boundary', async () => {
    // The point of the sliding counter. A fixed window would let a caller
    // spend `max` at the end of one window and `max` again a millisecond
    // later — 2× the budget in an instant, which is the burst that matters
    // for a cost ceiling.
    vi.useFakeTimers({ toFake: ['Date'] });
    const app = makeApp();
    const ip = freshIp();
    const max = RATE_LIMITS.checkoutPreview;

    // Spend the whole budget late in the window.
    vi.advanceTimersByTime(RATE_LIMIT_WINDOW_MS - 1_000);
    for (let i = 0; i < max; i++) {
      expect((await hit(app, API_PATHS.CHECKOUT_PREVIEW, ip)).status).toBe(200);
    }

    // Step just over the boundary and try to spend it all again.
    vi.advanceTimersByTime(2_000);
    let allowed = 0;
    for (let i = 0; i < max; i++) {
      if ((await hit(app, API_PATHS.CHECKOUT_PREVIEW, ip)).status === 200) {
        allowed++;
      }
    }

    expect(allowed).toBeLessThan(max);
  });
});

describe('the payment callback answers a browser, not a script', () => {
  it('redirects to the failure page instead of returning JSON', async () => {
    const app = makeApp();
    const ip = freshIp();

    for (let i = 0; i <= RATE_LIMITS.paymentCallback; i++) {
      await hit(app, API_PATHS.PAYMENT_CALLBACK, ip);
    }
    const res = await hit(app, API_PATHS.PAYMENT_CALLBACK, ip);

    // Zarinpal sends the shopper's own browser here. A JSON body would render
    // as raw text in their window right after they paid.
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(checkoutFailurePath());
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('still answers every other route with the JSON envelope', async () => {
    const app = makeApp();
    const ip = freshIp();

    for (let i = 0; i <= RATE_LIMITS.checkoutPreview; i++) {
      await hit(app, API_PATHS.CHECKOUT_PREVIEW, ip);
    }

    expect((await hit(app, API_PATHS.CHECKOUT_PREVIEW, ip)).status).toBe(429);
  });
});

describe('the bucket map is bounded', () => {
  // Without this the limiter is itself a denial-of-service vector: until the
  // origin is locked to Cloudflare a caller can rotate `cf-connecting-ip` and
  // mint one live entry per request, and a prune cannot reclaim entries that
  // have not expired yet.
  it('never grows past the cap, however many distinct callers arrive', async () => {
    const app = makeApp();

    for (let i = 0; i < MAX_RATE_LIMIT_BUCKETS + 500; i++) {
      await hit(
        app,
        API_PATHS.PRODUCTS,
        `10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`,
      );
    }

    expect(bucketCount()).toBeLessThanOrEqual(MAX_RATE_LIMIT_BUCKETS);
  });

  it('throttles callers arriving past the cap rather than handing them a free pass', async () => {
    const app = makeApp();

    // Fill the map.
    for (let i = 0; i < MAX_RATE_LIMIT_BUCKETS; i++) {
      await hit(
        app,
        API_PATHS.PRODUCTS,
        `10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`,
      );
    }

    // Everyone past the cap shares one bucket, so a flood of new addresses
    // exhausts that shared budget instead of each getting a fresh one.
    let refused = false;
    for (let i = 0; i < RATE_LIMITS.catalog + 5; i++) {
      const res = await hit(
        app,
        API_PATHS.PRODUCTS,
        `172.16.${i >> 8}.${i & 255}`,
      );
      if (res.status === 429) {
        refused = true;
        break;
      }
    }

    expect(refused).toBe(true);
  });

  it('keeps overflow callers on their own per-group budget', async () => {
    // The overflow bucket used to be ONE key for every group, so once the map
    // filled, a catalogue flood spent the budget payment callbacks rely on —
    // and the ceiling applied flipped between the two groups' maxima depending
    // on which request happened to arrive.
    const app = makeApp();

    for (let i = 0; i < MAX_RATE_LIMIT_BUCKETS; i++) {
      await hit(
        app,
        API_PATHS.PRODUCTS,
        `10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`,
      );
    }

    // Exhaust the overflow catalogue budget with brand-new addresses.
    for (let i = 0; i < RATE_LIMITS.catalog + 5; i++) {
      await hit(app, API_PATHS.PRODUCTS, `172.16.${i >> 8}.${i & 255}`);
    }
    expect((await hit(app, API_PATHS.PRODUCTS, '172.31.0.1')).status).toBe(429);

    // The payment callback's overflow budget must be untouched by that.
    expect(
      (await hit(app, API_PATHS.PAYMENT_CALLBACK, '172.31.0.2')).status,
    ).toBe(200);
  });

  it('does not evict an established caller to make room for a new one', async () => {
    // Evict-oldest would let a flood rotate a legitimate caller out of their
    // bucket, which *grants* them a fresh budget — the opposite of the goal.
    const app = makeApp();
    const established = freshIp();

    for (let i = 0; i < RATE_LIMITS.catalog; i++) {
      await hit(app, API_PATHS.PRODUCTS, established);
    }

    for (let i = 0; i < MAX_RATE_LIMIT_BUCKETS + 100; i++) {
      await hit(
        app,
        API_PATHS.PRODUCTS,
        `10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`,
      );
    }

    expect((await hit(app, API_PATHS.PRODUCTS, established)).status).toBe(429);
  });
});

describe('who the caller is', () => {
  it('ignores a forged cf-connecting-ip when the deploy has not declared Cloudflare', async () => {
    vi.stubEnv('APP_CONFIG_TRUST_CF_HEADER', '');
    resetRateLimitBuckets();
    const app = makeApp();

    // Rotating the CF header must NOT mint a fresh bucket each time, or the
    // limiter protects nothing against a direct-to-origin attacker.
    let refused = false;
    for (let i = 0; i < RATE_LIMITS.catalog + 5; i++) {
      const res = await hit(app, API_PATHS.PRODUCTS, `203.0.113.${i % 250}`);
      if (res.status === 429) {
        refused = true;
        break;
      }
    }

    expect(refused).toBe(true);
  });
});
