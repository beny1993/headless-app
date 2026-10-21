import { getIP } from 'better-auth/api';

import { getEnvFlag, VARS } from '@/lib/utils/env';

/**
 * The one ordered client-IP header list. Better Auth's `ipAddressHeaders` and
 * the Hono rate limiter both read it from here, so the two can never disagree
 * about who a caller is — a disagreement would put one of them in a different
 * bucket than the other, silently.
 *
 * `X-Real-IP` is trusted ONLY when the deploy declares it is behind the CDN.
 * ArvanCloud sets it to the visitor's address, and Traefik keeps it only from
 * the ranges in its `forwardedHeaders.trustedIPs`, replacing it with the TCP
 * peer for anyone else — so it cannot be forged *through* the CDN. On an origin
 * reachable directly it is just a string the caller chose, and a fresh value per
 * request mints a fresh rate-limit bucket every time, which is no rate limit at
 * all. Default off means an un-proxied deploy falls back to `x-forwarded-for`
 * (which Traefik overwrites) rather than failing open. Back behind Cloudflare
 * this would be `cf-connecting-ip` again: Cloudflare does not set X-Real-IP.
 *
 * This is a function, not a constant, so the flag is read from the environment
 * rather than baked into the build — it is a runtime switch, like the other
 * `APP_CONFIG_*` ones, and needs no rebuild.
 *
 * Note where each caller reads it, because the two differ: the Hono limiter
 * calls `clientIpFrom` per request, while `src/lib/auth/index.ts` evaluates
 * this ONCE, at module load, inside the top-level `betterAuth({...})` call. So
 * a change to the variable reaches Better Auth only on the next process start.
 * That is fine — Coolify restarts the container on an env change — but it means
 * the two are guaranteed to agree per process, not per request.
 */
export const clientIpHeaders = (): string[] =>
  getEnvFlag(VARS.APP_CONFIG_TRUST_REAL_IP_HEADER)
    ? ['x-real-ip', 'x-forwarded-for']
    : ['x-forwarded-for'];

/**
 * Resolves the caller's address, or `null` when no header can be trusted.
 *
 * Delegates to Better Auth's own `getIP` rather than parsing headers here, so
 * precedence, the single-hop `x-forwarded-for` rule and IPv6 /64 bucketing are
 * literally the same code the auth limiter uses — not a mirror of it that can
 * drift. A multi-hop `x-forwarded-for` resolves to `null` by design: trusting
 * its first entry is how a forger picks their own bucket.
 */
export const clientIpFrom = (headers: Headers): string | null => {
  // Annotated, not cast. A force-cast here would let a Better Auth upgrade
  // rename or restructure this option and still compile — `getIP` would then
  // silently fall back to its own default header handling, resolving callers
  // by a rule nobody chose, on the path that decides who gets rate limited.
  const options: Parameters<typeof getIP>[1] = {
    advanced: { ipAddress: { ipAddressHeaders: clientIpHeaders() } },
  };
  return getIP(headers, options);
};
