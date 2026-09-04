import { describe, expect, it } from 'vitest';
import {
  IMAGE_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  objectKeyFor,
  sniffImageType,
  UPLOAD_FILENAME_PATTERN,
  UPLOAD_KEY_PREFIX,
} from './image-upload';

/** Build a byte array from a signature, padded so WEBP's offset-8 marker fits. */
const bytesOf = (...signature: number[]): Uint8Array => {
  const buffer = new Uint8Array(Math.max(16, signature.length));
  buffer.set(signature);
  return buffer;
};

const JPEG = bytesOf(0xff, 0xd8, 0xff, 0xe0);
const PNG = bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
// "RIFF" + 4 size bytes + "WEBP".
const WEBP = bytesOf(
  0x52,
  0x49,
  0x46,
  0x46,
  0x00,
  0x00,
  0x00,
  0x00,
  0x57,
  0x45,
  0x42,
  0x50,
);

describe('sniffImageType', () => {
  it('recognizes JPEG, PNG and WEBP by their leading bytes', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(WEBP)).toBe('image/webp');
  });

  it('rejects a non-image, whatever it claims to be', () => {
    // A script, a PDF, an empty file — none carry an image signature.
    expect(sniffImageType(new TextEncoder().encode('<?php echo 1; ?>'))).toBe(
      null,
    );
    expect(sniffImageType(bytesOf(0x25, 0x50, 0x44, 0x46))).toBe(null); // %PDF
    expect(sniffImageType(new Uint8Array(0))).toBe(null);
  });

  it('does not mistake a non-WEBP RIFF container for an image', () => {
    // A WAV is RIFF too; the "WEBP" tag at offset 8 is what separates them.
    const wav = bytesOf(
      0x52,
      0x49,
      0x46,
      0x46,
      0x00,
      0x00,
      0x00,
      0x00,
      0x57,
      0x41,
      0x56,
      0x45,
    );
    expect(sniffImageType(wav)).toBe(null);
  });
});

describe('objectKeyFor', () => {
  it('produces a prefixed uuid key with the extension for the type', () => {
    for (const [type, ext] of Object.entries(IMAGE_EXTENSIONS)) {
      const key = objectKeyFor(type as keyof typeof IMAGE_EXTENSIONS);
      expect(key.startsWith(`${UPLOAD_KEY_PREFIX}/`)).toBe(true);
      expect(key.endsWith(`.${ext}`)).toBe(true);
      // The filename half is exactly a uuid + our extension — the shape the
      // serving route will accept, and nothing an attacker could steer.
      expect(key.slice(UPLOAD_KEY_PREFIX.length + 1)).toMatch(
        UPLOAD_FILENAME_PATTERN,
      );
    }
  });

  it('never repeats a key', () => {
    const keys = new Set(
      Array.from({ length: 100 }, () => objectKeyFor('image/png')),
    );
    expect(keys.size).toBe(100);
  });
});

describe('UPLOAD_FILENAME_PATTERN', () => {
  it('accepts a uuid filename and rejects every traversal shape', () => {
    expect('123e4567-e89b-12d3-a456-426614174000.jpg').toMatch(
      UPLOAD_FILENAME_PATTERN,
    );
    for (const bad of [
      '../secret.jpg',
      '..%2fsecret.jpg',
      'a/b.jpg',
      '.env',
      'products/cat-dry-food.jpg', // seed keys are served from public/, not here
      '123e4567-e89b-12d3-a456-426614174000.svg', // not an accepted extension
      '123e4567-e89b-12d3-a456-426614174000', // no extension
    ]) {
      expect(bad).not.toMatch(UPLOAD_FILENAME_PATTERN);
    }
  });
});

describe('MAX_UPLOAD_BYTES', () => {
  it('is the 2 MB the design promises', () => {
    expect(MAX_UPLOAD_BYTES).toBe(2 * 1024 * 1024);
  });
});
