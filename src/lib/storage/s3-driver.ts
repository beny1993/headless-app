// The S3-compatible object-storage driver — the production storage backend, so
// uploaded images survive a redeploy instead of landing on the container's
// ephemeral disk. Selected by `APP_CONFIG_STORAGE_PROVIDER=s3`; `local` stays the
// default so `pnpm dev`/CI need no bucket. Written against Liara's documented
// Next.js setup (`region: 'default'`, `forcePathStyle: true`) but provider-neutral
// behind the seam — Arvan or any S3-compatible endpoint works with the same vars.
//
// What keeps it safe mirrors the local driver: it only ever writes or deletes
// under the `uploads/` namespace, so a "change image" can never touch a committed
// `products/…` or `site/…` asset (those are served from `public/`, never uploaded).
// The stored content type is the *sniffed* one the caller passes, never a
// client-declared value — the trust boundary from `image-upload.ts` is unchanged.
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getEnvVariable, VARS } from '@/lib/utils/env';
import { UPLOAD_KEY_PREFIX } from './image-upload';
import type { StorageDriver } from './index';

/** Refuse any key that is not a single flat filename under the `uploads/`
 *  namespace, before a network call — parity with the local driver's stricter
 *  `resolveUnderRoot` (a `uploads/../products/x` shape is rejected, not just a
 *  wrong prefix). Keys are server-generated uuids, so this only ever trips on a
 *  crafted key, but the guard stays as tight as the local driver's. */
const assertUploadsKey = (key: string): void => {
  const prefix = `${UPLOAD_KEY_PREFIX}/`;
  const rest = key.startsWith(prefix) ? key.slice(prefix.length) : null;
  if (rest === null || rest.includes('/') || rest.includes('..')) {
    throw new Error(`not an uploads key: ${key}`);
  }
};

// Browser-cache forever: keys are fresh uuids (`objectKeyFor`), never overwritten,
// so a stored object is immutable and safe to cache indefinitely.
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

// The client and bucket are read once, on first use — not at import (so
// `next build` never needs S3 config; the seam's factory isolates this) and not
// per call. The required-var reads throw loudly here if a key is missing or
// misnamed, rather than failing silently mid-upload.
let cached: { client: S3Client; bucket: string } | undefined;

const getClient = (): { client: S3Client; bucket: string } => {
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
    assertUploadsKey(key);
    const { client, bucket } = getClient();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        CacheControl: IMMUTABLE_CACHE,
        // No ACL: the bucket itself is public (object-read). Per-object ACLs are
        // not set, matching Liara's documented flow.
      }),
    );
  },

  async delete(key) {
    assertUploadsKey(key);
    const { client, bucket } = getClient();
    // S3 DeleteObject is idempotent — deleting a missing key succeeds — so there
    // is no not-found branch to mirror the local driver's ENOENT handling.
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  },
};

// Test-only: drop the memoized client so a suite can restub env between cases.
export const __resetS3ClientForTests = (): void => {
  cached = undefined;
};
