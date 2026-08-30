import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Plain Node output — the app ships as a Docker image to an Iranian PaaS,
  // never to a serverless/Vercel runtime.
  output: 'standalone',
  images: {
    // AVIF first, then WebP fallback — materially smaller for photographic
    // content; browsers that don't accept AVIF fall back automatically.
    formats: ['image/avif', 'image/webp'],
  },
};

export default nextConfig;
