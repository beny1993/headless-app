// The s3 driver's half of the receipt privacy contract: a receipt lives in the
// same bucket as the product photos, written private and uncacheable, read back
// with the app's key — and, because the bucket's anonymous-read rule is one
// panel toggle away from covering it again, every upload is probed as a
// stranger would see it. Readable → deleted, reported by key, refused.
//
// The AWS SDK and the network are mocked at the module edge; nothing here
// reaches a bucket. The live proof is `pnpm verify-s3`, on staging, by hand.
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

  it('probes the stored receipt the way a stranger would: its public URL, one byte, uncached', async () => {
    const { s3Driver } = await freshDriver();

    await s3Driver.put(RECEIPT, bytes, 'image/jpeg');

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/${RECEIPT}`);
    expect(new Headers(init.headers).get('range')).toBe('bytes=0-0');
    // Anonymous: nothing that could authorize the read rides along.
    expect(new Headers(init.headers).get('authorization')).toBeNull();
    expect(init.cache).toBe('no-store');
  });

  it.each([200, 206])(
    'takes a receipt the bucket serves to anyone (%i) back out, reports only its key, and refuses',
    async (status) => {
      const { s3Driver, ReceiptExposedError } = await freshDriver();
      mocks.fetch.mockResolvedValue(new Response('x', { status }));

      await expect(
        s3Driver.put(RECEIPT, bytes, 'image/jpeg'),
      ).rejects.toBeInstanceOf(ReceiptExposedError);

      expect(mocks.DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'smokeypetshop',
        Key: RECEIPT,
      });
      expect(commandsSent()).toEqual(['PutObject', 'DeleteObject']);
      expect(mocks.captureMessage).toHaveBeenCalledTimes(1);
      // The key and nothing else of the upload: no bytes, no URL with a host.
      const reported = JSON.stringify(mocks.captureMessage.mock.calls[0]);
      expect(reported).toContain(RECEIPT);
      expect(reported).not.toContain(BASE);
    },
  );

  it.each([401, 403, 404, 500])(
    'keeps a receipt the bucket will not serve to a stranger (%i)',
    async (status) => {
      const { s3Driver } = await freshDriver();
      mocks.fetch.mockResolvedValue(new Response(null, { status }));

      await expect(
        s3Driver.put(RECEIPT, bytes, 'image/jpeg'),
      ).resolves.toBeUndefined();

      expect(commandsSent()).toEqual(['PutObject']);
      expect(mocks.captureMessage).not.toHaveBeenCalled();
    },
  );

  it('keeps the receipt when the probe cannot reach the bucket at all', async () => {
    // Liara unreachable is not proof of exposure; a shopper is never refused
    // for it.
    const { s3Driver } = await freshDriver();
    mocks.fetch.mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      s3Driver.put(RECEIPT, bytes, 'image/jpeg'),
    ).resolves.toBeUndefined();
    expect(commandsSent()).toEqual(['PutObject']);
  });

  it('refuses a receipt outright when there is no public base to probe, storing nothing', async () => {
    // Nothing to probe with means nothing proves the receipt private.
    const { s3Driver, ReceiptExposedError } = await freshDriver('');

    await expect(
      s3Driver.put(RECEIPT, bytes, 'image/jpeg'),
    ).rejects.toBeInstanceOf(ReceiptExposedError);

    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('never probes a product photo, which is public on purpose', async () => {
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
