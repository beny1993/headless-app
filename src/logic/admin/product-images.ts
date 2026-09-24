// Storing a product image touches two things — the storage driver (the file) and
// `ProductDao` (the row) — so it lives here, not in the route handler. The route
// owns validation (auth, content-type sniff, size); this owns the store-then-
// record-then-clean-up sequence once the bytes are known to be a real image.
//
// A product holds up to `MAX_PRODUCT_IMAGES` photos in the admin's order, so
// there are two writes, and only one of them deletes:
//
//   · an upload APPENDS — one row at the end of the gallery, touching no file
//     that is already there. It runs under a row lock and re-checks the ceiling
//     inside the transaction, so two uploads racing cannot both win and strand
//     the loser's file with no row to find it by;
//   · a gallery-order write REPLACES the list, and is the only place a file is
//     ever deleted — and then only the keys the write itself removed, which it
//     reports, never the whole previous list and never a set worked out from
//     the caller's own snapshot. An upload that lands between the route's read
//     and this write has its row replaced like any other; taking the delete
//     set from the snapshot would have kept its file with nothing referencing
//     it, and this loop is the only thing that would ever have collected it.
//
// `ProductDao.setImages` is «replace with this ordered list» and belongs to the
// second of those; the append has its own atomic write. The cleanup, not the
// write, is where the thinking is. A seed product's
// bundled `products/…` asset is never handed to the driver: it lives in
// `public/`, it is not ours to delete, and the local driver refuses keys outside
// `uploads/` anyway — the filter here is what keeps that refusal from ever
// firing and being swallowed.
import * as Sentry from '@sentry/nextjs';
import { ProductDao } from '@/db/dao/ProductDao';
import { MAX_PRODUCT_IMAGES } from '@/lib/catalog/product-input';
import type { ProductWithImages } from '@/db/schema/catalog';
import {
  objectKeyFor,
  UPLOAD_KEY_PREFIX,
  type AcceptedImageType,
} from '@/lib/storage/image-upload';
import { getStorageDriver, type StorageDriver } from '@/lib/storage';
import { imageSrc } from '@/lib/storage/image-url';

/** What the upload route hands back — the stored key and a URL to render it. */
export type StoredImage = {
  id: string;
  objectKey: string;
  url: string;
  sortOrder: number;
};

const isOurUpload = (objectKey: string): boolean =>
  objectKey.startsWith(`${UPLOAD_KEY_PREFIX}/`);

const toStoredImage = (image: {
  id: string;
  objectKey: string;
  sortOrder: number;
}): StoredImage => ({
  id: image.id,
  objectKey: image.objectKey,
  url: imageSrc(image.objectKey),
  sortOrder: image.sortOrder,
});

/**
 * Deletes a file nothing references any more. A failure is swallowed — an
 * orphaned file is housekeeping, never a reason to fail a write the database has
 * already taken — which is exactly why it is reported: an EACCES, an expired S3
 * credential or a driver refusal otherwise piles up orphans in total silence.
 */
const deleteQuietly = (driver: StorageDriver, key: string): Promise<void> =>
  driver.delete(key).catch((error: unknown) => {
    console.warn('[admin] deleting a product image failed', error);
    Sentry.captureException(error);
  });

/**
 * Add `bytes` to the end of the product's gallery and return the stored image.
 * The key is generated from the sniffed type (never a client filename), written
 * through the configured storage driver, then recorded on `product_images`.
 *
 * Nothing is deleted here. The photos already on the product keep their rows
 * and their files — that is the difference between this and the single-slot
 * version it replaces, and the reason a product can hold a gallery at all.
 *
 * The caller enforces the count ceiling *before* reading the body, so a refused
 * photo is never buffered and can never leave an orphaned file behind.
 */
export async function appendProductImage(
  product: ProductWithImages,
  bytes: Uint8Array,
  type: AcceptedImageType,
): Promise<StoredImage | null> {
  const driver = getStorageDriver();
  const key = objectKeyFor(type);

  await driver.put(key, bytes, type);
  // ponytail: no orphan sweep for a put that succeeds but whose row write then
  // throws — a rare crash leaves one unreferenced file on disk, cleaned by a
  // future storage audit, not worth a saga here. A *refusal* is different: it
  // is an ordinary outcome, it lands after the file is already written, and it
  // is handled below rather than left to that audit.
  const image = await ProductDao.appendImage(
    product.id,
    key,
    MAX_PRODUCT_IMAGES,
  );

  if (!image) {
    // The gallery filled while these bytes were in flight, or the product went.
    // The file has no row and never will, so take it back out — the only other
    // deleter works out what to delete from `product_images` and would never
    // see it.
    await deleteQuietly(driver, key);
    return null;
  }

  return toStoredImage(image);
}

/**
 * Store the admin's gallery order: `objectKeys` becomes the product's images,
 * in that order, and every file the admin dropped is deleted.
 *
 * The keys must be the product's own — set membership against its current
 * images, which is the ownership check the API leans on, since a body reaches
 * here having been checked for shape and nothing else. Returns `null` when a
 * key belongs to no image of this product, having written nothing at all; the
 * route turns that into a 400.
 *
 * The deleted set is whatever the write actually removed, restricted to
 * `uploads/`. It is *not* «everything previous», and not a diff of the
 * caller's snapshot either: reordering deletes nothing, removing one photo
 * deletes one file, the photos that stay keep theirs, and a photo appended
 * between the route's read and this write loses its row — last-write-wins, as
 * a wholesale replace always is — without stranding its file. A failure to delete is
 * swallowed — an orphaned file is housekeeping, never a reason to fail a write
 * the database has already taken — but it is reported to Sentry, because silent
 * orphan accumulation is invisible until the bucket bill says otherwise.
 */
export async function setProductImageOrder(
  product: ProductWithImages,
  objectKeys: readonly string[],
): Promise<StoredImage[] | null> {
  const own = new Set(product.images.map((image) => image.objectKey));
  if (!objectKeys.every((key) => own.has(key))) return null;

  const driver = getStorageDriver();
  // The delete set comes back from the write, not from the snapshot the route
  // read: an upload that lands between that read and this transaction has its
  // row deleted here too, and deriving the set from the snapshot would leave
  // its file behind with nothing referencing it — invisible to this loop
  // forever, since the loop works from the rows.
  const { images, removedKeys } = await ProductDao.setImages(product.id, [
    ...objectKeys,
  ]);

  for (const objectKey of removedKeys) {
    if (!isOurUpload(objectKey)) continue;
    await deleteQuietly(driver, objectKey);
  }

  return images.map(toStoredImage);
}
