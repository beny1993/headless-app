import type { NextConfig } from 'next';

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
        // The back-office magic link carries the sign-in OTP in its query
        // string; this keeps that URL out of the Referer sent to third parties.
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    },
  ],
};

export default nextConfig;
