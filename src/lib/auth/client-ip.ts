import { getIp } from 'better-auth/api';

import { getEnvFlag, VARS } from '@/lib/utils/env';

/**
 * The one ordered client-IP header list. Better Auth's `ipAddressHeaders` and
 * the Hono rate limiter both read it from here, so the two can never disagree
 * about who a caller is — a disagreement would put one of them in a different
 * bucket than the other, silently.
 *
 * `CF-Connecting-IP` is trusted ONLY when the deploy declares it is behind
 * Cloudflare. Cloudflare sets that header itself and overwrites any client copy,
 * so it cannot be forged *through* Cloudflare — but on an origin reachable
 * directly it is just a string the caller chose, and a fresh value per request
 * mints a fresh rate-limit bucket every time, which is no rate limit at all.
 * Default off means an un-proxied deploy falls back to `x-forwarded-for`
 * (which Traefik overwrites) rather than failing open.
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
  getEnvFlag(VARS.APP_CONFIG_TRUST_CF_HEADER)
    ? ['cf-connecting-ip', 'x-forwarded-for']
    : ['x-forwarded-for'];

/**
 * Resolves the caller's address, or `null` when no header can be trusted.
 *
 * Delegates to Better Auth's own `getIp` rather than parsing headers here, so
 * precedence, the single-hop `x-forwarded-for` rule and IPv6 /64 bucketing are
 * literally the same code the auth limiter uses — not a mirror of it that can
 * drift. A multi-hop `x-forwarded-for` resolves to `null` by design: trusting
 * its first entry is how a forger picks their own bucket.
 */
export const clientIpFrom = (headers: Headers): string | null => {
  // Annotated, not cast. A force-cast here would let a Better Auth upgrade
  // rename or restructure this option and still compile — `getIp` would then
  // silently fall back to its own default header handling, resolving callers
  // by a rule nobody chose, on the path that decides who gets rate limited.
  const options: Parameters<typeof getIp>[1] = {
    advanced: { ipAddress: { ipAddressHeaders: clientIpHeaders() } },
  };
  return getIp(headers, options);
};
