// A read-only client for our self-hosted Umami's REST API, for the admin
// insights page (`src/logic/admin/product-insights.ts`). Server-only: it holds
// the view-only user's password and the bearer token Umami trades it for.
//
// Three rules, each because the page must render without Umami:
//   · Not configured ⇒ `off`. Local dev, tests and staging have no Umami.
//   · Anything going wrong (a timeout, an HTTP error, a body that is not the
//     shape below) ⇒ `unavailable`, logged without the credentials. Never a throw.
//   · A result is cached for `CACHE_TTL_MS` per window, so an admin flipping
//     between windows or reloading does not cost a round trip each time; a
//     failure for `FAILURE_TTL_MS`, so a down Umami costs one timeout a
//     minute, not one per reload. One deadline covers a whole read.
//
// Self-hosted Umami has no API keys, so the client signs in
// (`POST /api/auth/login`) and keeps the token in memory; a 401 later means it
// expired, and the client signs in once more before giving up.
//
// Umami v2 names the page metric `url`, v3 renamed it `path` and refuses the
// old name with a 400. Which version analytics.bendev.ir runs is not this
// file's business: it asks for `url`, falls back to `path` on a 400, and
// remembers whichever worked.
import { z } from 'zod';
import { getEnvVariable, isProductionServer, VARS } from '@/lib/utils/env';

/**
 * For a whole read, every request in it together (sign-in, retry, the v3
 * fallback): a slow Umami must not hold the admin page hostage.
 */
export const UMAMI_TIMEOUT_MS = 4_000;
/** How long one window's numbers are served from memory. */
export const CACHE_TTL_MS = 5 * 60_000;
/**
 * How long a failed read is remembered: while Umami is down, a reload shows
 * «unavailable» at once instead of waiting out the timeout again.
 */
export const FAILURE_TTL_MS = 60_000;
/** Rows per metric. Umami sorts by count, so this keeps the head of the list. */
const METRIC_LIMIT = 500;

/** What the insights page asks for: pageviews per path, or visits per source. */
export type UmamiMetricKind = 'pages' | 'referrers';

/** One row of a metric: the path or referrer domain, and its count. */
export type UmamiMetricRow = { key: string; count: number };

export type UmamiResult =
  | { status: 'ok'; rows: UmamiMetricRow[] }
  | { status: 'off' }
  | { status: 'unavailable' };

type UmamiConfig = {
  origin: string;
  websiteId: string;
  username: string;
  password: string;
};

// https only in a deployed build: the password and the bearer token travel to
// this host. Plain http is for a local stand-in.
const configSchema = z.object({
  scriptUrl: z.url({ protocol: isProductionServer() ? /^https$/ : /^https?$/ }),
  websiteId: z.string().trim().min(1),
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

/** The four values, or `null` when any is missing or the script URL is not one. */
const readConfig = (): UmamiConfig | null => {
  const parsed = configSchema.safeParse({
    scriptUrl: getEnvVariable(VARS.NEXT_PUBLIC_UMAMI_SCRIPT_URL, false, ''),
    websiteId: getEnvVariable(VARS.NEXT_PUBLIC_UMAMI_WEBSITE_ID, false, ''),
    username: getEnvVariable(VARS.APP_CONFIG_UMAMI_USERNAME, false, ''),
    password: getEnvVariable(VARS.APP_CONFIG_UMAMI_PASSWORD, false, ''),
  });
  if (!parsed.success) return null;
  const { scriptUrl, websiteId, username, password } = parsed.data;
  return {
    origin: new URL(scriptUrl).origin,
    websiteId,
    username,
    password,
  };
};

const loginSchema = z.object({ token: z.string().min(1) });

// `x` is null for Umami's «(none)» bucket — a visit with no referrer.
const metricsSchema = z.array(
  z.object({ x: z.string().nullable(), y: z.number().int().nonnegative() }),
);

/** A failure the caller reports as `unavailable`; the message is for the log. */
class UmamiError extends Error {}

let token: string | null = null;
/** `url` (v2) until a 400 says the server wants `path` (v3). */
let pageMetricType: 'url' | 'path' = 'url';
const cache = new Map<string, { at: number; rows: UmamiMetricRow[] }>();
const failures = new Map<string, number>();

// Every request: one shared deadline, no cache, and no redirects — a redirect
// would resend the sign-in body, password included, to wherever it points.
const requestInit = (signal: AbortSignal) =>
  ({ signal, cache: 'no-store', redirect: 'error' }) as const;

const signIn = async (
  config: UmamiConfig,
  signal: AbortSignal,
): Promise<string> => {
  const response = await fetch(`${config.origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: config.username,
      password: config.password,
    }),
    ...requestInit(signal),
  });
  if (!response.ok) throw new UmamiError(`login answered ${response.status}`);
  const parsed = loginSchema.safeParse(await response.json());
  if (!parsed.success) throw new UmamiError('login answered an unknown shape');
  return parsed.data.token;
};

const requestMetric = (
  config: UmamiConfig,
  bearer: string,
  type: string,
  startAt: number,
  endAt: number,
  signal: AbortSignal,
) => {
  const params = new URLSearchParams({
    type,
    startAt: String(startAt),
    endAt: String(endAt),
    limit: String(METRIC_LIMIT),
  });
  return fetch(
    `${config.origin}/api/websites/${encodeURIComponent(config.websiteId)}/metrics?${params}`,
    {
      headers: { authorization: `Bearer ${bearer}` },
      ...requestInit(signal),
    },
  );
};

const fetchMetric = async (
  config: UmamiConfig,
  kind: UmamiMetricKind,
  startAt: number,
  endAt: number,
): Promise<UmamiMetricRow[]> => {
  const signal = AbortSignal.timeout(UMAMI_TIMEOUT_MS);
  const metric = (bearer: string, type: string) =>
    requestMetric(config, bearer, type, startAt, endAt, signal);
  let signedInNow = false;
  if (!token) {
    token = await signIn(config, signal);
    signedInNow = true;
  }
  let type = kind === 'pages' ? pageMetricType : 'referrer';
  let response = await metric(token, type);

  // An expired token: one fresh sign-in, unless this one is already fresh.
  if (response.status === 401 && !signedInNow) {
    token = await signIn(config, signal);
    response = await metric(token, type);
  }
  // v3 refuses v2's metric name: switch once, and remember.
  if (response.status === 400 && kind === 'pages' && type === 'url') {
    type = 'path';
    response = await metric(token, type);
    if (response.ok) pageMetricType = 'path';
  }
  if (response.status === 401) token = null;
  if (!response.ok) {
    throw new UmamiError(`metrics(${type}) answered ${response.status}`);
  }

  const parsed = metricsSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new UmamiError(`metrics(${type}) answered an unknown shape`);
  }
  return parsed.data.flatMap((row) =>
    row.x === null ? [] : [{ key: row.x, count: row.y }],
  );
};

/**
 * One Umami metric over the last `days` days, ending now. `pages` is
 * pageviews per path; `referrers` is visits per referring domain. Never
 * throws: see the file header for `off` and `unavailable`.
 */
export const readUmamiMetric = async (
  kind: UmamiMetricKind,
  days: number,
  now: Date = new Date(),
): Promise<UmamiResult> => {
  const config = readConfig();
  if (!config) return { status: 'off' };

  const cacheKey = `${kind}:${days}`;
  const cached = cache.get(cacheKey);
  if (cached && now.getTime() - cached.at < CACHE_TTL_MS) {
    return { status: 'ok', rows: cached.rows };
  }
  const failedAt = failures.get(cacheKey);
  if (failedAt !== undefined && now.getTime() - failedAt < FAILURE_TTL_MS) {
    return { status: 'unavailable' };
  }

  const endAt = now.getTime();
  const startAt = endAt - days * 24 * 60 * 60_000;
  try {
    const rows = await fetchMetric(config, kind, startAt, endAt);
    cache.set(cacheKey, { at: now.getTime(), rows });
    failures.delete(cacheKey);
    return { status: 'ok', rows };
  } catch (error) {
    // The reason only: never the config, which carries the password.
    const reason =
      error instanceof UmamiError
        ? error.message
        : error instanceof Error
          ? error.name
          : 'unknown';
    console.warn(`[umami] ${kind} unavailable: ${reason}`);
    failures.set(cacheKey, now.getTime());
    return { status: 'unavailable' };
  }
};
