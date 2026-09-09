import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const publicFile = (name: string) => path.join(process.cwd(), 'public', name);
const appFile = (name: string) => path.join(process.cwd(), 'src', 'app', name);

const readPng = (name: string) => {
  const image = readFileSync(publicFile(name));
  expect(image.subarray(1, 4).toString()).toBe('PNG');

  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
    colorType: image.readUInt8(25),
  };
};

const manifestSchema = z.object({
  name: z.string().min(1),
  short_name: z.string().min(1),
  lang: z.literal('fa'),
  dir: z.literal('rtl'),
  start_url: z.literal('/'),
  icons: z.array(
    z.object({
      src: z.string().startsWith('/'),
      sizes: z.string().regex(/^\d+x\d+$/),
      type: z.literal('image/png'),
    }),
  ),
});

describe('brand assets', () => {
  it.each([
    ['favicon-16x16.png', 16],
    ['favicon-32x32.png', 32],
    ['android-chrome-192x192.png', 192],
    ['android-chrome-512x512.png', 512],
    ['brand/smokey-mark.png', 512],
  ])('ships %s as a transparent square at the declared size', (name, size) => {
    expect(readPng(name)).toEqual({
      width: size,
      height: size,
      colorType: 6,
    });
  });

  it('ships an opaque Apple touch icon at 180 pixels', () => {
    expect(readPng('apple-touch-icon.png')).toEqual({
      width: 180,
      height: 180,
      colorType: 2,
    });
  });

  it('ships the full transparent logo at its intrinsic dimensions', () => {
    expect(readPng('brand/smokey-logo-primary.png')).toEqual({
      width: 1375,
      height: 1144,
      colorType: 6,
    });
    expect(
      readFileSync(publicFile('brand/smokey-logo-primary.jpg')).length,
    ).toBeGreaterThan(100_000);
  });

  it('packs 16, 32 and 48 pixel images into favicon.ico', () => {
    const icon = readFileSync(appFile('favicon.ico'));
    const count = icon.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, index) => {
      const entry = 6 + index * 16;
      return [icon.readUInt8(entry), icon.readUInt8(entry + 1)];
    });

    expect(sizes).toEqual([
      [16, 16],
      [32, 32],
      [48, 48],
    ]);
  });

  it('declares the Android icons in a valid Persian RTL manifest', () => {
    const manifest = manifestSchema.parse(
      JSON.parse(readFileSync(publicFile('site.webmanifest'), 'utf8')),
    );

    expect(manifest.icons).toEqual([
      {
        src: '/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ]);
  });
});
