import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the AWS SDK at the module edge — no network, ever. `send` is a recorder;
// the command constructors echo their input so we can assert exactly what would
// be sent to the bucket.
const sendMock = vi.fn().mockResolvedValue({});

// Regular functions, not arrows: the driver `new`s all three, and an arrow
// cannot be a constructor.
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return { send: sendMock };
  }),
  PutObjectCommand: vi.fn(function (input) {
    return { __command: 'PutObject', input };
  }),
  DeleteObjectCommand: vi.fn(function (input) {
    return { __command: 'DeleteObject', input };
  }),
}));

import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { __resetS3ClientForTests, s3Driver } from './s3-driver';

const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const KEY = 'uploads/123e4567-e89b-12d3-a456-426614174000.webp';

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue({});
  __resetS3ClientForTests();
  vi.stubEnv('LIARA_ENDPOINT', 'https://storage.c2.liara.site');
  vi.stubEnv('LIARA_BUCKET_NAME', 'smokeypetshop');
  vi.stubEnv('LIARA_ACCESS_KEY', 'test-access-key');
  vi.stubEnv('LIARA_SECRET_KEY', 'test-secret-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('s3Driver', () => {
  it('constructs the client for the Liara endpoint, region "default", path-style', async () => {
    await s3Driver.put(KEY, bytes, 'image/webp');
    expect(S3Client).toHaveBeenCalledWith({
      region: 'default',
      endpoint: 'https://storage.c2.liara.site',
      credentials: {
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key',
      },
      forcePathStyle: true,
    });
  });

  it('puts an uploads object with the sniffed content type and an immutable cache header', async () => {
    await s3Driver.put(KEY, bytes, 'image/webp');
    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'smokeypetshop',
      Key: KEY,
      Body: bytes,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('deletes an uploads object', async () => {
    await s3Driver.delete(KEY);
    expect(DeleteObjectCommand).toHaveBeenCalledWith({
      Bucket: 'smokeypetshop',
      Key: KEY,
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('refuses to put or delete a key outside the uploads namespace, before any request', async () => {
    // A bundled products/… asset must never be reachable — same invariant as the
    // local driver, so "change image" can never clobber a committed file.
    await expect(
      s3Driver.put('products/cat-dry-food.jpg', bytes, 'image/jpeg'),
    ).rejects.toThrow(/uploads/);
    await expect(s3Driver.delete('products/cat-dry-food.jpg')).rejects.toThrow(
      /uploads/,
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('refuses a traversal-shaped key even under the uploads prefix', async () => {
    // Parity with the local driver: `uploads/../products/x` starts with the
    // prefix but must still be rejected (no nested path, no `..`).
    for (const bad of [
      'uploads/../products/x.jpg',
      'uploads/nested/x.jpg',
      'uploads/..',
    ]) {
      await expect(s3Driver.put(bad, bytes, 'image/jpeg')).rejects.toThrow(
        /uploads/,
      );
    }
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('throws loudly when a required credential var is missing (e.g. a mistyped key name)', async () => {
    vi.stubEnv('LIARA_SECRET_KEY', '');
    __resetS3ClientForTests();
    await expect(s3Driver.put(KEY, bytes, 'image/webp')).rejects.toThrow(
      /LIARA_SECRET_KEY/,
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('resolves a bundled key root-relative through the shared resolver', () => {
    // url() delegates to imageSrc; bundled keys are root-relative in every mode
    // (the uploads-with-base case is covered in image-url.test.ts).
    expect(s3Driver.url('products/cat-dry-food.jpg')).toBe(
      '/products/cat-dry-food.jpg',
    );
  });
});
