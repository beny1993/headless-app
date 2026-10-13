// From `/config`, not the package root: the root re-export is deprecated and
// stops working in SDK v11.
import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';
import { z } from 'zod';

// When uploads live in object storage (production `s3`), `next/image` must be
// told the bucket host is allowed — an un-allowlisted remote host is blocked.
// Derived from the same build-time base URL the browser resolves image src from,
// so the two can never disagree; empty (local dev/test) ⇒ no remote pattern.
const storageBaseUrl = process.env.NEXT_PUBLIC_STORAGE_BASE_URL?.trim();
const storageRemotePatterns: NonNullable<
  NonNullable<NextConfig['images']>['remotePatterns']
> = storageBaseUrl
  ? (() => {
      const url = new URL(storageBaseUrl);
      const basePath = url.pathname.replace(/\/$/, '');
      // The base must carry the bucket path. A bare host would collapse the
      // pattern to `/**` and turn next/image into an open proxy for the whole
      // (shared) storage host — other tenants' public objects included. Fail the
      // build loudly rather than ship that.
      if (!basePath) {
        throw new Error(
          `NEXT_PUBLIC_STORAGE_BASE_URL must include the bucket path ` +
            `(e.g. https://host/<bucket>), got a bare host: ${storageBaseUrl}`,
        );
      }
      return [
        {
          protocol: url.protocol.replace(':', '') as 'http' | 'https',
          hostname: url.hostname,
          port: url.port,
          // Path-style bucket URL: the bucket's `uploads/` only — the photos
          // `imageSrc` builds bucket URLs for (UPLOAD_KEY_PREFIX). Never
          // `receipts/`: the optimizer would hand a receipt back public and
          // cacheable from the shop's own origin.
          pathname: `${basePath}/uploads/**`,
        },
      ];
    })()
  : [];

// The E2E suite's own `next dev` (playwright.config.ts sets `E2E_SERVER`) builds
// into a folder of its own and starts without Turbopack's dev cache. Unset, as
// for `pnpm dev`, `next build` and the Docker image, Next's defaults stand.
//
// Its own folder, because Next allows one `next dev` per build folder: in
// `.next` the suite could not start beside a running `pnpm dev`. No dev cache,
// because of a reload loop: the server answered every page load with a reload
// ("HMR hash mismatch" on its HMR socket), and the spec on that page timed
// out, sign-in included. Each time it appeared, the server had started on a
// cache left by an earlier one: a `.next` shared by servers on different ports
// after files changed while none ran, and once right after a run Playwright
// ended with SIGKILL (as it does while `webServer.gracefulShutdown` is unset).
// With the cache off it never appeared. The price is a cold compile of every
// route each run, and `⨯ turbopackFileSystemCacheForDev` in the startup banner.
//
// Blank means unset, as for the provider switches in src/lib/utils/env.ts; a
// value it cannot read stops the server rather than guessing.
const e2eServer = z
  .enum(['true', 'false'])
  .safeParse(process.env.E2E_SERVER?.trim() || 'false');
if (!e2eServer.success) {
  throw new Error(
    `E2E_SERVER must be "true", "false" or unset, got ${JSON.stringify(process.env.E2E_SERVER)}`,
  );
}
const isE2EServer = e2eServer.data === 'true';

/**
 * Spread first into the config below, which sets neither key. One that ever
 * sets `experimental` must merge this in, or the E2E server loses it silently
 * (next.config.test.ts would say so).
 */
const e2eServerConfig: NextConfig = isE2EServer
  ? {
      distDir: '.next-e2e',
      experimental: { turbopackFileSystemCacheForDev: false },
    }
  : {};

const nextConfig: NextConfig = {
  ...e2eServerConfig,
  // Plain Node output — the app ships as a Docker image to an Iranian PaaS,
  // never to a serverless/Vercel runtime.
  output: 'standalone',
  // Don't advertise the framework and its version to scanners.
  poweredByHeader: false,
  images: {
    // AVIF first, then WebP fallback — materially smaller for photographic
    // content; browsers that don't accept AVIF fall back automatically.
    formats: ['image/avif', 'image/webp'],
    remotePatterns: storageRemotePatterns,
  },
  // Baseline security headers for every response. No CSP yet — that needs the
  // storefront's real asset inventory, so it belongs to a front-end story.
  // No HSTS either: TLS is terminated by the PaaS proxy, which owns that header.
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        // Keeps paths and query strings out of the Referer sent to third
        // parties — `/login?next=…` says where a shopper was headed, and an
        // order or payment-result URL says what they bought.
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    },
  ],
};

// Source-map upload, release creation and the plugin's own telemetry are the
// three things that make `next build` talk to sentry.io. The build runs inside
// the Docker image ON the Iranian VPS, where sentry.io answers 403 (see
// docs/DEPLOY.md), so all three are off unless a SENTRY_AUTH_TOKEN is present —
// which is also the only way to have readable production stack traces. Leaving
// them on without a token just prints a warning on every build, and this repo
// treats a build warning as a failed gate.
const hasSentryAuthToken = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default withSentryConfig(nextConfig, {
  org: 'benyamin-chehrazi',
  project: 'javascript-nextjs',
  authToken: process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
  sourcemaps: { disable: !hasSentryAuthToken },
  release: { create: hasSentryAuthToken },
  // Minified client frames are unreadable without these; harmless when upload
  // is off, since nothing is uploaded either way.
  widenClientFileUpload: true,
  // Without a token the plugin's only output is "no auth token, will not create
  // release" on every single build — it warns before it ever consults
  // `release.create`. Nothing it could say in that state is actionable, and this
  // repo treats a build warning as a failed gate. With a token, its warnings are
  // about real upload failures, so let them through.
  silent: !hasSentryAuthToken,
  // No `tunnelRoute`: it only ever existed to route browser events around
  // sentry.io's block on Iranian IPs, and the backend is GlitchTip now, which
  // answers from Iran. Browsers post to it directly. Re-add it only if a future
  // backend becomes unreachable from a shopper's browser.
  // Deliberately absent: `disableLogger` and `automaticVercelMonitors`. Both are
  // deprecated in favour of `webpack.*` equivalents that Turbopack — which is
  // what `next build` uses on Next 16 — does not support, so setting either only
  // buys a deprecation warning. Vercel is not a deploy target here anyway.
});
