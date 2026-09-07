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

export default nextConfig;
