// The S3-compatible object-storage driver — the production storage backend, so
// uploaded images survive a redeploy instead of landing on the container's
// ephemeral disk. Selected by `APP_CONFIG_STORAGE_PROVIDER=s3`; `local` stays the
// default so `pnpm dev`/CI need no bucket. Written against Liara's documented
// Next.js setup (`region: 'default'`, `forcePathStyle: true`) but provider-neutral
// behind the seam — Arvan or any S3-compatible endpoint works with the same vars.
//
// What keeps it safe mirrors the local driver: it only ever writes, reads or
// deletes under the `uploads/` and `receipts/` namespaces, so a "change image"
// can never touch a committed `products/…` or `site/…` asset (those are served
// from `public/`, never uploaded). The stored content type is the *sniffed* one
// the caller passes, never a client-declared value — the trust boundary from
// `image-upload.ts` is unchanged.
//
// Receipts share the bucket with the product photos, and the bucket's anonymous
// read is narrowed to `uploads/` by policy (`scripts/set-bucket-policy.ts`) —
// a rule one panel toggle can silently undo. So every receipt `put` ends with a
// probe: fetch the object as a stranger would; if the bucket serves it, raise
// the alarm and refuse the upload (`ReceiptExposedError`). The object is deleted
// when the bucket allows it, and the server log says whether it was.
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import * as Sentry from '@sentry/nextjs';
import { getEnvVariable, VARS } from '@/lib/utils/env';
import { imageSrc } from './image-url';
import {
  isReceiptKey,
  RECEIPT_KEY_PREFIX,
  UPLOAD_KEY_PREFIX,
} from './image-upload';
import type { StorageDriver } from './index';

/**
 * A receipt was — or could not be proven not to be — readable by anyone who
 * has its URL. The upload is refused; an object already stored is deleted when
 * the bucket allows it, and the server log says whether it was.
 */
export class ReceiptExposedError extends Error {
  constructor(readonly key: string) {
    super(`receipt is readable anonymously or cannot be probed: ${key}`);
    this.name = 'ReceiptExposedError';
  }
}

/** Refuse any key that is not a single flat filename under the `uploads/` or
 *  `receipts/` namespace, before a network call — parity with the local
 *  driver's stricter `resolveUnderRoot` (a `uploads/../products/x` shape is
 *  rejected, not just a wrong prefix). Keys are server-generated uuids, so this
 *  only ever trips on a crafted key, but the guard stays as tight as the local
 *  driver's. */
const assertStorageKey = (key: string): void => {
  const prefix = [UPLOAD_KEY_PREFIX, RECEIPT_KEY_PREFIX].find((candidate) =>
    key.startsWith(`${candidate}/`),
  );
  const rest = prefix === undefined ? null : key.slice(prefix.length + 1);
  if (!rest || rest.includes('/') || rest.includes('..')) {
    throw new Error(`not an uploads or receipts key: ${key}`);
  }
};

// Browser-cache forever: keys are fresh uuids (`objectKeyFor`), never overwritten,
// so a stored object is immutable and safe to cache indefinitely.
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

// A receipt is nobody's to cache: not a CDN's, not a shared proxy's.
const PRIVATE_CACHE = 'private, no-store';

/** How long the anonymous probe waits before calling the bucket unreachable. */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * Whether the bucket serves `url` to a stranger. Any 2xx is exposure — a 200,
 * the 206 the one-byte range asks for, or the 203 of a proxy that transformed
 * what it fetched — and every refusal is not. A probe that cannot run
 * at all (unreachable, timed out) is not either — card to card is the only way
 * to pay, and a shopper is never turned away because Liara was unreachable —
 * but it is no proof of privacy, so it is reported: a warning with the error's
 * name, never the key. Redirects are followed: whatever finally answers 2xx
 * for this URL is somewhere a stranger can read it.
 */
const readableByAnyone = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, {
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // The answer is whether the status was a 2xx, read before the body is let
    // go: a cancel that fails afterwards changes nothing about it, so it is
    // ignored rather than allowed to turn exposure into the could-not-run path.
    const { ok } = response;
    await response.body?.cancel().catch(() => {});
    return ok;
  } catch (error) {
    Sentry.captureMessage('[storage] receipt privacy probe could not run', {
      level: 'warning',
      extra: { reason: (error as Error).name },
    });
    return false;
  }
};

// The client and bucket are read once, on first use — not at import (so
// `next build` never needs S3 config; the seam's factory isolates this) and not
// per call. The required-var reads throw loudly here if a key is missing or
// misnamed, rather than failing silently mid-upload. Exported for the one
// script that talks to the bucket itself (`scripts/set-bucket-policy.ts`).
let cached: { client: S3Client; bucket: string } | undefined;

export const getS3Client = (): { client: S3Client; bucket: string } => {
  if (!cached) {
    cached = {
      bucket: getEnvVariable(VARS.LIARA_BUCKET_NAME, true),
      client: new S3Client({
        // Liara's S3-compatible API uses a fixed region name, not an AWS region.
        region: 'default',
        endpoint: getEnvVariable(VARS.LIARA_ENDPOINT, true),
        credentials: {
          accessKeyId: getEnvVariable(VARS.LIARA_ACCESS_KEY, true),
          secretAccessKey: getEnvVariable(VARS.LIARA_SECRET_KEY, true),
        },
        // Path-style (`endpoint/bucket/key`) per Liara's Next.js doc; the public
        // URL `imageSrc` builds matches this addressing.
        forcePathStyle: true,
      }),
    };
  }
  return cached;
};

export const s3Driver: StorageDriver = {
  async put(key, data, contentType) {
    assertStorageKey(key);
    const receipt = isReceiptKey(key);
    // The probe's URL, checked before anything is written: with no public base
    // there is nothing to probe with, so nothing proves the receipt private.
    const base = getEnvVariable(VARS.NEXT_PUBLIC_STORAGE_BASE_URL, false, '');
    if (receipt && !base.trim()) throw new ReceiptExposedError(key);

    const { client, bucket } = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        CacheControl: receipt ? PRIVATE_CACHE : IMMUTABLE_CACHE,
        // No ACL: access is the bucket's — public read on `uploads/` only.
        // Per-object ACLs are not set, matching Liara's documented flow.
      }),
    );

    if (receipt && (await readableByAnyone(`${base.trim()}/${key}`))) {
      // The alarm first, and keyless: whatever the delete does next, it has
      // been raised.
      Sentry.captureMessage('[storage] a receipt was readable anonymously', {
        level: 'error',
      });
      let deleted = false;
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        );
        deleted = true;
      } catch {
        // Said below, with the key. The upload is refused either way.
      }
      // The key, for whoever follows the alarm up, on the server's own console
      // only: src/lib/sentry.ts removes the integration that would carry
      // console output to the error tracker.
      console.error(
        `[storage] receipt readable anonymously: ${key}; deleted: ${deleted}`,
      );
      throw new ReceiptExposedError(key);
    }
  },

  async get(key) {
    assertStorageKey(key);
    const { client, bucket } = getS3Client();
    try {
      const { Body } = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      return Body ? await Body.transformToByteArray() : null;
    } catch (error) {
      if ((error as Error).name === 'NoSuchKey') return null;
      throw error;
    }
  },

  async delete(key) {
    assertStorageKey(key);
    const { client, bucket } = getS3Client();
    // S3 DeleteObject is idempotent — deleting a missing key succeeds — so there
    // is no not-found branch to mirror the local driver's ENOENT handling.
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  },

  // Reads resolve through the shared client-safe resolver, so a server-rendered
  // URL and a browser-rendered one are byte-identical (see image-url.ts). It
  // throws on a receipt, which has no public URL.
  url(key) {
    return imageSrc(key);
  },
};

// Test-only: drop the memoized client so a suite can restub env between cases.
export const __resetS3ClientForTests = (): void => {
  cached = undefined;
};
