// The s3 driver's receipts: stored in the same public bucket as the product
// photos, under `receipts/`, uncacheable, read back with the app's key — and
// never given a URL by the app: a shopper or an admin reads one only through
// the authenticated receipt routes. No probe: the bucket's public read covers
// receipts by Benyamin's decision (2026-10-06).
//
// The AWS SDK and the network are mocked at the module edge; nothing here
// reaches a bucket.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  captureMessage: vi.fn(),
  fetch: vi.fn(),
  // Regular functions, not arrows: the driver `new`s them.
  PutObjectCommand: vi.fn(function (input: unknown) {
    return { __command: 'PutObject', input };
  }),
  DeleteObjectCommand: vi.fn(function (input: unknown) {
    return { __command: 'DeleteObject', input };
  }),
  GetObjectCommand: vi.fn(function (input: unknown) {
    return { __command: 'GetObject', input };
  }),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return { send: mocks.send };
  }),
  PutObjectCommand: mocks.PutObjectCommand,
  DeleteObjectCommand: mocks.DeleteObjectCommand,
  GetObjectCommand: mocks.GetObjectCommand,
}));
vi.mock('@sentry/nextjs', () => ({
  captureMessage: mocks.captureMessage,
  captureException: vi.fn(),
}));

const BASE = 'https://storage.c2.liara.site/smokeypetshop';
const RECEIPT = 'receipts/123e4567-e89b-12d3-a456-426614174000.jpg';
const PHOTO = 'uploads/123e4567-e89b-12d3-a456-426614174000.jpg';
const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/**
 * The driver, loaded with `base` as the build-time public base. The env module
 * captures NEXT_PUBLIC_* at load (so the bundler can inline it), which is why
 * the module graph is reset rather than the variable merely stubbed.
 */
const freshDriver = async (base = BASE) => {
  vi.stubEnv('NEXT_PUBLIC_STORAGE_BASE_URL', base);
  vi.resetModules();
  return import('./s3-driver');
};

const commandsSent = () =>
  mocks.send.mock.calls.map(
    ([command]) => (command as { __command: string }).__command,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue({});
  mocks.fetch.mockResolvedValue(new Response(null, { status: 403 }));
  vi.stubGlobal('fetch', mocks.fetch);
  vi.stubEnv('LIARA_ENDPOINT', 'https://storage.c2.liara.site');
  vi.stubEnv('LIARA_BUCKET_NAME', 'smokeypetshop');
  vi.stubEnv('LIARA_ACCESS_KEY', 'test-access-key');
  vi.stubEnv('LIARA_SECRET_KEY', 'test-secret-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('s3Driver — receipts', () => {
  it('stores a receipt private and uncacheable, with its sniffed type', async () => {
    const { s3Driver } = await freshDriver();

    await s3Driver.put(RECEIPT, bytes, 'image/jpeg');

    expect(mocks.PutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'smokeypetshop',
      Key: RECEIPT,
      Body: bytes,
      ContentType: 'image/jpeg',
      CacheControl: 'private, no-store',
    });
  });

  it('stores a receipt with nothing checked over the network — nor a public base needed', async () => {
    const { s3Driver } = await freshDriver('');

    await s3Driver.put(RECEIPT, bytes, 'image/jpeg');

    expect(commandsSent()).toEqual(['PutObject']);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('stores a product photo cacheable forever', async () => {
    const { s3Driver } = await freshDriver();

    await s3Driver.put(PHOTO, bytes, 'image/jpeg');

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Key: PHOTO,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  });

  it('reads a receipt back with the app key', async () => {
    const { s3Driver } = await freshDriver();
    mocks.send.mockResolvedValue({
      Body: { transformToByteArray: async () => bytes },
    });

    expect(await s3Driver.get(RECEIPT)).toEqual(bytes);
    expect(mocks.GetObjectCommand).toHaveBeenCalledWith({
      Bucket: 'smokeypetshop',
      Key: RECEIPT,
    });
  });

  it('answers null for an object that is gone', async () => {
    const { s3Driver } = await freshDriver();
    mocks.send.mockRejectedValue(
      Object.assign(new Error('The specified key does not exist.'), {
        name: 'NoSuchKey',
      }),
    );

    expect(await s3Driver.get(RECEIPT)).toBeNull();
  });

  it('lets any other read failure be the error it is', async () => {
    const { s3Driver } = await freshDriver();
    mocks.send.mockRejectedValue(
      Object.assign(new Error('Access Denied'), { name: 'AccessDenied' }),
    );

    await expect(s3Driver.get(RECEIPT)).rejects.toThrow('Access Denied');
  });

  it('has no URL for a receipt', async () => {
    const { s3Driver } = await freshDriver();
    expect(() => s3Driver.url(RECEIPT)).toThrow(/receipt/);
  });

  it('refuses a receipt key that is not one flat name, before any request', async () => {
    const { s3Driver } = await freshDriver();
    for (const bad of [
      'receipts/../uploads/x.jpg',
      'receipts/nested/x.jpg',
      'receipts/..',
    ]) {
      await expect(s3Driver.put(bad, bytes, 'image/jpeg')).rejects.toThrow();
      await expect(s3Driver.get(bad)).rejects.toThrow();
      await expect(s3Driver.delete(bad)).rejects.toThrow();
    }
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
