// Storing a product image touches two things — the storage driver (the file) and
// `ProductDao` (the row) — so it lives here, not in the route handler. The route
// owns validation (auth, content-type sniff, size); this owns the store-then-
// record-then-clean-up sequence once the bytes are known to be a real image.
//
// The admin form has a single image slot, so an upload *replaces* the product's
// gallery rather than appending — `setImages([key])`. Old files that we uploaded
// are then deleted so they do not accumulate; a seed product's bundled
// `products/…` asset is left on disk untouched, because the local driver refuses
// to delete anything outside its own `uploads/` namespace.
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

/**
 * Store `bytes` as the product's image and return it. The key is generated from
 * the sniffed type (never a client filename), written through the configured
 * storage driver, then recorded on `product_images`.
 *
 * Best-effort cleanup: previously-uploaded files are deleted after the row swap,
 * and a failure to delete one is swallowed — an orphaned file is a housekeeping
 * matter, never a reason to fail an upload that already succeeded.
 */
export async function replaceProductImage(
  product: ProductWithImages,
  bytes: Uint8Array,
  type: AcceptedImageType,
): Promise<StoredImage> {
  const driver = getStorageDriver();
  const key = objectKeyFor(type);

  await driver.put(key, bytes, type);
  const [image] = await ProductDao.setImages(product.id, [key]);

  // ponytail: no orphan sweep for a put that succeeds but whose row swap then
  // fails — a rare crash leaves one unreferenced file on disk, cleaned by a
  // future storage audit, not worth a saga here.
  for (const previous of product.images) {
    if (previous.objectKey.startsWith(`${UPLOAD_KEY_PREFIX}/`)) {
      await driver.delete(previous.objectKey).catch(() => {});
    }
  }

  return {
    id: image.id,
    objectKey: image.objectKey,
    url: driver.url(image.objectKey),
    sortOrder: image.sortOrder,
  };
}
