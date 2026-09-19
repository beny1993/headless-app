// Storing a product image touches two things — the storage driver (the file) and
// `ProductDao` (the row) — so it lives here, not in the route handler. The route
// owns validation (auth, content-type sniff, size); this owns the store-then-
// record-then-clean-up sequence once the bytes are known to be a real image.
//
// A product holds up to `MAX_PRODUCT_IMAGES` photos in the admin's order, so
// there are two writes, and only one of them deletes:
//
//   · an upload APPENDS — it adds a key to the end of the gallery and touches
//     no file that is already there;
//   · a gallery-order write REPLACES the list, and is the only place a file is
//     ever deleted — and then only the keys the admin dropped, never the whole
//     previous list.
//
// `ProductDao.setImages` is «replace with this ordered list» for both, which is
// why the cleanup, not the write, is where the thinking is. A seed product's
// bundled `products/…` asset is never handed to the driver: it lives in
// `public/`, it is not ours to delete, and the local driver refuses keys outside
// `uploads/` anyway — the filter here is what keeps that refusal from ever
// firing and being swallowed.
import { ProductDao } from '@/db/dao/ProductDao';
import type { ProductWithImages } from '@/db/schema/catalog';
import {
  objectKeyFor,
  UPLOAD_KEY_PREFIX,
  type AcceptedImageType,
} from '@/lib/storage/image-upload';
import { getStorageDriver } from '@/lib/storage';

/** What the upload route hands back — the stored key and a URL to render it. */
export type StoredImage = {
  id: string;
  objectKey: string;
  url: string;
  sortOrder: number;
};

const isOurUpload = (objectKey: string): boolean =>
  objectKey.startsWith(`${UPLOAD_KEY_PREFIX}/`);

const toStoredImage = (
  image: { id: string; objectKey: string; sortOrder: number },
  url: (key: string) => string,
): StoredImage => ({
  id: image.id,
  objectKey: image.objectKey,
  url: url(image.objectKey),
  sortOrder: image.sortOrder,
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
): Promise<StoredImage> {
  const driver = getStorageDriver();
  const key = objectKeyFor(type);

  await driver.put(key, bytes, type);
  // ponytail: no orphan sweep for a put that succeeds but whose row write then
  // fails — a rare crash leaves one unreferenced file on disk, cleaned by a
  // future storage audit, not worth a saga here.
  //
  // ponytail: `setImages` replaces the list, so two *concurrent* appends do not
  // exceed the ceiling — the second overwrites the first and one photo is lost.
  // The form uploads its files one after another, so this cannot happen from
  // the UI; it needs a per-product lock or an insert-returning-count if it ever
  // does.
  const images = await ProductDao.setImages(product.id, [
    ...product.images.map((image) => image.objectKey),
    key,
  ]);

  return toStoredImage(images[images.length - 1], (key) => driver.url(key));
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
 * The deleted set is exactly `previous − kept`, restricted to `uploads/`. It is
 * *not* «everything previous»: reordering deletes nothing, removing one photo
 * deletes one file, and the photos that stay keep theirs. A failure to delete is
 * swallowed — an orphaned file is housekeeping, never a reason to fail a write
 * the database has already taken.
 */
export async function setProductImageOrder(
  product: ProductWithImages,
  objectKeys: readonly string[],
): Promise<StoredImage[] | null> {
  const own = new Set(product.images.map((image) => image.objectKey));
  if (!objectKeys.every((key) => own.has(key))) return null;

  const driver = getStorageDriver();
  const images = await ProductDao.setImages(product.id, [...objectKeys]);

  const kept = new Set(objectKeys);
  for (const previous of product.images) {
    if (kept.has(previous.objectKey) || !isOurUpload(previous.objectKey)) {
      continue;
    }
    await driver.delete(previous.objectKey).catch(() => {});
  }

  return images.map((image) => toStoredImage(image, (key) => driver.url(key)));
}
