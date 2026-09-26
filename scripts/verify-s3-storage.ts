/**
 * One-off live check of the S3 (Liara) storage driver against the REAL bucket.
 *
 *   pnpm verify-s3
 *
 * It uploads a tiny throwaway object, fetches its public URL over HTTP, then
 * deletes it and confirms the URL stops resolving. This is the empirical proof
 * of three independent things the mocked unit tests cannot check: that the SDK's
 * path-style addressing reaches Liara, that the bucket is public-read, and that
 * the public URL `imageSrc` builds is the correct one.
 *
 * NOT part of `pnpm test` — it needs real credentials and writes to the live
 * bucket (briefly). Requires, in `.env`: LIARA_ENDPOINT, LIARA_BUCKET_NAME,
 * LIARA_ACCESS_KEY, LIARA_SECRET_KEY, and NEXT_PUBLIC_STORAGE_BASE_URL
 * (= endpoint/bucket). Safe to re-run: the object it creates, it deletes.
 */
import './load-env';
import { s3Driver } from '@/lib/storage/s3-driver';

// A 1x1 transparent PNG, so a real image byte stream round-trips.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const key = `uploads/${crypto.randomUUID()}.png`;

const main = async () => {
  console.log(`→ put   ${key}`);
  await s3Driver.put(key, PNG_1X1, 'image/png');

  const url = s3Driver.url(key);
  console.log(`→ url   ${url}`);
  if (!url.startsWith('http')) {
    throw new Error(
      'url() is not absolute — is NEXT_PUBLIC_STORAGE_BASE_URL set to the bucket base?',
    );
  }

  const got = await fetch(url);
  console.log(
    `→ GET   ${got.status} ${got.headers.get('content-type') ?? '(no type)'}`,
  );
  if (got.status !== 200) {
    throw new Error(
      `public GET returned ${got.status}; is the bucket set public (object-read)?`,
    );
  }

  console.log(`→ delete ${key}`);
  await s3Driver.delete(key);

  const gone = await fetch(url, { cache: 'no-store' });
  console.log(`→ GET   ${gone.status} (expect 403/404)`);
  if (gone.status === 200) {
    throw new Error('object still readable after delete');
  }

  console.log('\n✓ live round-trip OK: put → public GET 200 → delete → gone');
};

main().catch((error) => {
  console.error('\n✗ verification failed:', error);
  process.exit(1);
});
