import type { MiddlewareHandler } from 'hono';
import * as Sentry from '@sentry/nextjs';

import { clientIpFrom } from '@/lib/auth/client-ip';
import { API_PATHS, API_ROOT, checkoutFailurePath } from '@/lib/constant/paths';

import { apiError } from '../envelope';
import { rateLimitState, type Bucket } from './rate-limit-store';

/**
 * Which budget a request spends from. Path only — nothing in the table needs
 * the method, and a method-agnostic rule is the same shape the `requireAdmin`
 * mounts already use.
 */
type RateLimitGroup =
  'catalog' | 'paymentCallback' | 'checkoutPreview' | 'admin' | 'default';

/** One window for every group; only the budget differs. */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Requests per window, per caller, per group. Deliberately generous: these
 * bound what an attacker can drain, not what a shopper can do. Tighten from
 * real traffic once the shop has some — never from a hunch.
 *
 * Floors these must clear: the E2E suite runs from ONE bucket per group (in
 * dev and test an unresolvable caller becomes `127.0.0.1`), and its
 * one-fee-for-all spec PUTs every province row in a single loop.
 */
export const RATE_LIMITS: Record<RateLimitGroup, number> = {
  catalog: 120,
  paymentCallback: 30,
  checkoutPreview: 30,
  admin: 300,
  default: 120,
};

/**
 * Hard ceiling on tracked callers.
 *
 * Not a tuning knob — a safety limit. A prune only reclaims *expired* entries,
 * and within a window nothing has expired, so without this a caller who can
 * vary their apparent address mints one live entry per request and the limiter
 * becomes a memory-exhaustion vector against the box it protects. At the cap,
 * a caller we have not seen before is counted in their group's shared sentinel
 * bucket (see `bucketKeyFor`): throttled, not rotated in. 100k entries is a few
 * MB and far above any real visitor count.
 */
export const MAX_RATE_LIMIT_BUCKETS = 100_000;

export const RATE_LIMITED_MESSAGE =
  'تعداد درخواست‌ها بیش از حد مجاز است؛ لطفاً کمی بعد دوباره تلاش کنید.';

/** Where every caller we cannot place is counted — Better Auth's own sentinel. */
const NO_CLIENT_IP = 'no-trusted-ip';

/** Probes must never be counted: a throttled health check rolls the deploy back. */
const EXEMPT = new Set<string>([API_PATHS.HEALTH, API_PATHS.READY]);

const ADMIN_PREFIX = `${API_ROOT}/admin/`;

/**
 * Pure path → budget mapping. Exported so the table itself is tested rather
 * than inferred from a handful of requests.
 *
 * Returns `null` for the exempt probes.
 */
export const rateLimitGroupFor = (path: string): RateLimitGroup | null => {
  if (EXEMPT.has(path)) return null;

  if (
    path === API_PATHS.CATEGORIES ||
    path === API_PATHS.PRODUCTS ||
    path.startsWith(`${API_PATHS.PRODUCTS}/`)
  ) {
    return 'catalog';
  }

  if (path === API_PATHS.PAYMENT_CALLBACK) return 'paymentCallback';
  if (path === API_PATHS.CHECKOUT_PREVIEW) return 'checkoutPreview';

  // The trailing slash is load-bearing here, unlike the `/admin/` prefix above
  // it: `/api/shipping/rates` is the public read checkout uses, and
  // `/api/shipping/rates/3` is the admin write.
  if (
    path.startsWith(ADMIN_PREFIX) ||
    path.startsWith(`${API_PATHS.SHIPPING_RATES}/`) ||
    path === API_PATHS.PAYMENT_RECONCILE
  ) {
    return 'admin';
  }

  return 'default';
};

// ponytail: fixed budgets in a per-process Map — a dozen lines, no dependency.
// Ceilings: (1) budgets reset on every redeploy; (2) a second instance behind a
// load balancer would get its own budget — today there is one Coolify VPS and
// one replica (docs/DEPLOY.md §5); (3) while APP_CONFIG_TRUST_REAL_IP_HEADER is on
// and the origin is not yet locked to the CDN, a forged X-Real-IP can
// still mint keys — bounded by MAX_RATE_LIMIT_BUCKETS, closed for good by the
// origin lockdown. Upgrade path when a second replica appears: Better Auth's
// `rate_limit` table behind a RateLimitDao with a `hono:` key prefix, swapped in
// at the `buckets` calls below.
const { buckets } = rateLimitState;

/**
 * How many entries one prune pass may walk.
 *
 * The pass must never cost a single request a full scan of a map that is
 * allowed to hold 100k entries — which is exactly the state a flood puts it in.
 * Map iteration is insertion-ordered, so the oldest entries come first and a
 * bounded walk from the front reclaims the ones most likely to be expired.
 */
const PRUNE_SCAN_LIMIT = 1_000;

/** How often a pass runs, at most. Often enough to drain a full map steadily. */
const PRUNE_INTERVAL_MS = 1_000;

/** Drops entries whose previous AND current windows are both behind us. */
const prune = (now: number) => {
  let scanned = 0;
  for (const [key, bucket] of buckets) {
    if (++scanned > PRUNE_SCAN_LIMIT) break;
    if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS * 2) {
      buckets.delete(key);
    }
  }
  rateLimitState.nextPruneAt = now + PRUNE_INTERVAL_MS;
};

export { bucketCount, resetRateLimitBuckets } from './rate-limit-store';

/** Slots held back so each group's sentinel bucket always fits under the cap. */
const RESERVED_SENTINEL_SLOTS = Object.keys(RATE_LIMITS).length;

/**
 * Shouts once when traffic starts landing in a shared bucket.
 *
 * Both routes into one are misconfigurations that otherwise look exactly like
 * normal operation: a deploy behind a proxy with APP_CONFIG_TRUST_REAL_IP_HEADER
 * off resolves no caller at all, so the WHOLE SHOP shares one budget per group
 * and nothing says why sign-in suddenly fails; and a map at its cap means
 * something is minting addresses. A limit that trips silently is a shop that is
 * quietly broken.
 */
const warnSharedBucket = (reason: string) => {
  if (rateLimitState.sharedBucketWarned) return;
  rateLimitState.sharedBucketWarned = true;
  const message =
    `[rate-limit] counting requests in a SHARED bucket (${reason}). ` +
    'Every affected caller now spends one budget between them. If this is a ' +
    'CDN-fronted deploy, set APP_CONFIG_TRUST_REAL_IP_HEADER=true.';
  console.warn(message);
  // A static import, never a lazy `import()` again: that one was still loading
  // when rate-limit.test.ts ended, and vitest's teardown failed the whole run
  // with an EnvironmentTeardownError. Its reason — `src/test-setup.ts` loading
  // this module into every file — went when setup moved to `rate-limit-store`.
  Sentry.captureMessage(message, 'warning');
};

/**
 * Normally one bucket per caller per group.
 *
 * Once the map is full, a caller we have not seen before is counted in that
 * group's shared sentinel bucket — the same `no-trusted-ip|<group>` bucket
 * every unresolvable caller already uses, so the per-group isolation holds at
 * the cap too. Deliberately NOT evict-oldest: that would let a flood rotate an
 * established caller out and hand them a clean slate.
 */
const bucketKeyFor = (ip: string, group: RateLimitGroup): string => {
  const key = `${ip}|${group}`;
  if (buckets.has(key)) return key;
  if (buckets.size < MAX_RATE_LIMIT_BUCKETS - RESERVED_SENTINEL_SLOTS) {
    return key;
  }
  warnSharedBucket('the bucket map is at its cap');
  return `${NO_CLIENT_IP}|${group}`;
};

/** What one `spend` decides: let it through, or refuse and say for how long. */
type Spend = { overBudget: boolean; retryAfter: number };

/**
 * Seconds until the weighted count would actually fall below `max`.
 *
 * Not simply "what is left of this window": under a sliding counter the
 * previous window's spend is carried forward and decays, so a caller told to
 * wait until the boundary can be refused again the moment they retry. A client
 * that honours `Retry-After` would then loop on 429s instead of backing off.
 */
const secondsUntilUnderBudget = (
  bucket: Bucket,
  max: number,
  intoWindow: number,
): number => {
  const toBoundary = RATE_LIMIT_WINDOW_MS - intoWindow;

  // Inside this window the carried weight decays linearly with time.
  if (bucket.previous > 0) {
    const over =
      bucket.previous * (1 - intoWindow / RATE_LIMIT_WINDOW_MS) +
      bucket.current +
      1 -
      max;
    const perMs = bucket.previous / RATE_LIMIT_WINDOW_MS;
    const wait = over / perMs;
    if (wait <= toBoundary) return Math.max(1, Math.ceil(wait / 1000));
  }

  // Otherwise the window has to roll first, after which `current` becomes the
  // carried weight and decays from full.
  const carriedAfterRoll = bucket.current;
  if (carriedAfterRoll + 1 <= max) {
    return Math.max(1, Math.ceil(toBoundary / 1000));
  }
  const perMs = carriedAfterRoll / RATE_LIMIT_WINDOW_MS;
  const extra = (carriedAfterRoll + 1 - max) / perMs;
  return Math.max(1, Math.ceil((toBoundary + extra) / 1000));
};

/**
 * Counts one request and reports whether it is over budget, plus how long the
 * caller should wait. Pure apart from the map it mutates; no `await` between
 * the read and the write, so it is exact within the process.
 */
const spend = (key: string, max: number, now: number): Spend => {
  let bucket = buckets.get(key);

  if (!bucket) {
    bucket = { windowStart: now, current: 0, previous: 0 };
    buckets.set(key, bucket);
  }

  const elapsed = now - bucket.windowStart;
  if (elapsed >= RATE_LIMIT_WINDOW_MS * 2) {
    bucket.previous = 0;
    bucket.current = 0;
    bucket.windowStart = now;
  } else if (elapsed >= RATE_LIMIT_WINDOW_MS) {
    bucket.previous = bucket.current;
    bucket.current = 0;
    bucket.windowStart = bucket.windowStart + RATE_LIMIT_WINDOW_MS;
  }

  const intoWindow = now - bucket.windowStart;
  const carried = bucket.previous * (1 - intoWindow / RATE_LIMIT_WINDOW_MS);
  const counted = carried + bucket.current + 1;

  if (counted > max) {
    return {
      overBudget: true,
      retryAfter: secondsUntilUnderBudget(bucket, max, intoWindow),
    };
  }

  bucket.current += 1;
  return { overBudget: false, retryAfter: 0 };
};

/**
 * The ONE legitimate `app.use('*')` on this app.
 *
 * It must be registered before the first route: Hono runs a wildcard only for
 * routes registered after it, so mounting this any later would silently leave
 * the public catalogue and the Zarinpal callback — the two routes that cost the
 * most per call — uncovered, with every test still green. `app.test.ts` pins
 * the mount against exactly that regression.
 */
export const rateLimit: MiddlewareHandler = async (c, next) => {
  const group = rateLimitGroupFor(c.req.path);
  if (group === null) return next();

  const now = Date.now();
  if (now >= rateLimitState.nextPruneAt) prune(now);

  const resolved = clientIpFrom(c.req.raw.headers);
  if (resolved === null) {
    warnSharedBucket('no client address could be resolved from the headers');
  }

  const { overBudget, retryAfter } = spend(
    bucketKeyFor(resolved ?? NO_CLIENT_IP, group),
    RATE_LIMITS[group],
    now,
  );

  if (!overBudget) return next();

  c.header('Retry-After', String(retryAfter));

  // The gateway sends the shopper's own browser to the callback, so a JSON
  // body there would render as raw text in their window. Every other route is
  // called by our own code, which reads the envelope.
  if (group === 'paymentCallback') {
    return c.redirect(checkoutFailurePath(), 302);
  }

  return c.json(apiError(RATE_LIMITED_MESSAGE), 429);
};
