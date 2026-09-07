import { afterEach, describe, expect, it, vi } from 'vitest';

// `imageSrc` reads NEXT_PUBLIC_STORAGE_BASE_URL, which env.ts captures into its
// STATIC_INLINED_VARS map at module load (so the bundler can inline it for the
// client). A plain `vi.stubEnv` therefore does not reach it — the value must be
// set BEFORE the module graph is (re)loaded. So each case stubs the env, resets
// the module registry, then imports a fresh copy.
const BASE = 'https://storage.c2.liara.site/smokeypetshop';

const freshImageSrc = async (base: string) => {
  vi.stubEnv('NEXT_PUBLIC_STORAGE_BASE_URL', base);
  vi.resetModules();
  return (await import('./image-url')).imageSrc;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('imageSrc', () => {
  it('resolves an uploads key to the public base when it is set (s3 mode)', async () => {
    const imageSrc = await freshImageSrc(BASE);
    expect(imageSrc('uploads/123e4567-e89b-12d3-a456-426614174000.webp')).toBe(
      `${BASE}/uploads/123e4567-e89b-12d3-a456-426614174000.webp`,
    );
  });

  it('keeps bundled keys root-relative even when the base is set', async () => {
    // site/… and products/… are committed under public/ — they never live in the
    // bucket, so they must stay same-origin regardless of the storage provider.
    const imageSrc = await freshImageSrc(BASE);
    expect(imageSrc('products/cat-dry-food.jpg')).toBe(
      '/products/cat-dry-food.jpg',
    );
    expect(imageSrc('site/hero-home.jpg')).toBe('/site/hero-home.jpg');
  });

  it('resolves everything root-relative when the base is empty (local mode)', async () => {
    const imageSrc = await freshImageSrc('');
    // Uploads fall through to the local serving route at /uploads/*.
    expect(imageSrc('uploads/123e4567-e89b-12d3-a456-426614174000.webp')).toBe(
      '/uploads/123e4567-e89b-12d3-a456-426614174000.webp',
    );
    expect(imageSrc('products/cat-dry-food.jpg')).toBe(
      '/products/cat-dry-food.jpg',
    );
  });
});
