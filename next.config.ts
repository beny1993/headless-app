// From `/config`, not the package root: the root re-export is deprecated and
// stops working in SDK v11.
import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';

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
          // Path-style bucket URL: allow the bucket path and everything under it.
          pathname: `${basePath}/**`,
        },
      ];
    })()
  : [];

const nextConfig: NextConfig = {
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
  // Deliberately absent: `disableLogger` and `automaticVercelMonitors`. Both are
  // deprecated in favour of `webpack.*` equivalents that Turbopack — which is
  // what `next build` uses on Next 16 — does not support, so setting either only
  // buys a deprecation warning. Vercel is not a deploy target here anyway.
  //
  // Also absent: `tunnelRoute`. It proxies browser events through this server,
  // and this server is the thing that cannot reach sentry.io.
});
