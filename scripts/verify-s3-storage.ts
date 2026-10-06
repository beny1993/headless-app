/**
 * One-off live check of the S3 (Liara) storage driver against the REAL bucket.
 *
 *   pnpm verify-s3
 *
 * Photos and receipts, against the live bucket:
 *
 *   · a product photo (`uploads/…`): put → its public URL answers 200 to an
 *     anonymous GET → delete → gone. Proves the SDK's path-style addressing
 *     reaches Liara, that `uploads/` is public-read, and that the URL
 *     `imageSrc` builds is the right one.
 *   · a payment receipt (`receipts/…`): put → the driver reads the bytes back
 *     with the app key → `url()` refuses to build a URL → delete → gone. The
 *     bucket's public read covers receipts (Benyamin's decision, 2026-10-06):
 *     the app keeps them out of sight by never building their URL.
 *
 * NOT part of `pnpm test` — it needs real credentials and writes to the live
 * bucket (briefly). Staging and production share the bucket: run it where
 * Benyamin says to. Requires, in `.env`: LIARA_ENDPOINT, LIARA_BUCKET_NAME,
 * LIARA_ACCESS_KEY, LIARA_SECRET_KEY, and NEXT_PUBLIC_STORAGE_BASE_URL
 * (= endpoint/bucket). Safe to re-run: the objects it creates, it deletes —
 * on failure too.
 */
import './load-env';
import { s3Driver } from '@/lib/storage/s3-driver';

// A 1x1 transparent PNG, so a real image byte stream round-trips.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const photoKey = `uploads/${crypto.randomUUID()}.png`;
const receiptKey = `receipts/${crypto.randomUUID()}.png`;

const anonymousGet = (url: string) => fetch(url, { cache: 'no-store' });

const checkPhotos = async () => {
  console.log(`→ put   ${photoKey}`);
  await s3Driver.put(photoKey, PNG_1X1, 'image/png');

  const url = s3Driver.url(photoKey);
  console.log(`→ url   ${url}`);
  if (!url.startsWith('http')) {
    throw new Error(
      'url() is not absolute — is NEXT_PUBLIC_STORAGE_BASE_URL set to the bucket base?',
    );
  }

  const got = await anonymousGet(url);
  console.log(
    `→ GET   ${got.status} ${got.headers.get('content-type') ?? '(no type)'}`,
  );
  if (got.status !== 200) {
    throw new Error(
      `public GET returned ${got.status}; is uploads/ public-read (object-read)?`,
    );
  }

  console.log(`→ delete ${photoKey}`);
  await s3Driver.delete(photoKey);

  const gone = await anonymousGet(url);
  console.log(`→ GET   ${gone.status} (expect 403/404)`);
  if (gone.status === 200) {
    throw new Error('object still readable after delete');
  }
};

const checkReceipts = async () => {
  console.log(`→ put   ${receiptKey}`);
  await s3Driver.put(receiptKey, PNG_1X1, 'image/png');

  const read = await s3Driver.get(receiptKey);
  console.log(`→ get   ${read?.byteLength ?? 'null'} bytes with the app key`);
  if (!read || Buffer.compare(Buffer.from(read), PNG_1X1) !== 0) {
    throw new Error('the driver could not read the receipt back with its key');
  }

  let refused = false;
  try {
    s3Driver.url(receiptKey);
  } catch {
    refused = true;
  }
  console.log(`→ url   ${refused ? 'refused (expected)' : 'BUILT'}`);
  if (!refused) throw new Error('url() built a public URL for a receipt');

  console.log(`→ delete ${receiptKey}`);
  await s3Driver.delete(receiptKey);
  if ((await s3Driver.get(receiptKey)) !== null) {
    throw new Error('receipt still stored after delete');
  }
};

const main = async () => {
  try {
    await checkPhotos();
    await checkReceipts();
  } finally {
    // Idempotent: a second delete of a gone key succeeds.
    await Promise.allSettled([
      s3Driver.delete(photoKey),
      s3Driver.delete(receiptKey),
    ]);
  }
  console.log(
    '\n✓ live check OK: photos public (put → GET 200 → delete → gone); ' +
      'receipts (put → key read → no URL → gone)',
  );
};

main().catch((error) => {
  console.error('\n✗ verification failed:', error);
  process.exit(1);
});
