// The one decision in this module that neither a route nor a DAO can make:
// which files on disk are no longer the product's. Every case here is about
// that exact set.
//
// It is worth the file because the single-slot version deleted *every* previous
// `uploads/…` file on every write — correct while a product could hold one
// photo, and silent data loss the moment it can hold five: adding a second
// photo erased the first, and reordering erased all of them. The driver is a
// spy rather than a real one so the assertion is on the keys handed to
// `delete`, not on a directory listing afterwards.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductImage, ProductWithImages } from '@/db/schema/catalog';
import { MAX_PRODUCT_IMAGES } from '@/lib/catalog/product-input';

const { setImages, appendImage, put, remove, url, captureException } =
  vi.hoisted(() => ({
    setImages: vi.fn(),
    appendImage: vi.fn(),
    put: vi.fn(),
    remove: vi.fn(),
    url: vi.fn((key: string) => `/${key}`),
    captureException: vi.fn(),
  }));
vi.mock('@sentry/nextjs', () => ({ captureException }));
vi.mock('@/db/dao/ProductDao', () => ({
  ProductDao: { setImages, appendImage },
}));
vi.mock('@/lib/storage', () => ({
  getStorageDriver: () => ({ put, delete: remove, url }),
}));

import {
  ProductGoneError,
  appendProductImage,
  setProductImageOrder,
} from './product-images';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

const image = (objectKey: string, sortOrder: number): ProductImage => ({
  id: `row-${objectKey}`,
  productId: PRODUCT_ID,
  objectKey,
  sortOrder,
  createdAt: new Date('2026-09-20T00:00:00Z'),
});

/**
 * A product carrying exactly these image keys. Cast rather than filled in: the
 * module reads `id` and `images` and nothing else, and a full row here would be
 * thirty fields of noise that no assertion touches.
 */
const productWith = (...keys: string[]): ProductWithImages => {
  previousKeys = keys;
  return {
    id: PRODUCT_ID,
    images: keys.map(image),
  } as unknown as ProductWithImages;
};

/** Every key handed to `driver.delete`, in call order. */
const deletedKeys = () => remove.mock.calls.map(([key]) => key);

/**
 * What the gallery held in the *database* before the write under test.
 *
 * `productWith` seeds this from the snapshot it builds, which is the ordinary
 * case — but a test can widen it afterwards to say «the row set had moved on
 * since the caller read it», which is the whole point of the write reporting
 * its own deletions. With the two kept identical in every test, the fake's
 * delete set is a snapshot diff and a snapshot diff in the code under test
 * would pass.
 */
let previousKeys: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  previousKeys = [];
  remove.mockResolvedValue(undefined);
  put.mockResolvedValue(undefined);
  // The DAO replaces the gallery wholesale and returns what it stored, so the
  // fake answers with rows in the order it was given — which is also what makes
  // the returned `sortOrder` assertable.
  // Matches the real contract: the rows it wrote, plus the keys it removed.
  // The fake is told the previous list per test where that matters.
  setImages.mockImplementation(async (_id: string, keys: string[]) => ({
    images: keys.map(image),
    removedKeys: previousKeys.filter((key) => !keys.includes(key)),
  }));
  // The append is its own atomic write now: one row at the end, or `'full'` /
  // `'gone'` when it stored nothing. The fake answers the way the DAO does.
  appendImage.mockImplementation(async (_id: string, key: string) =>
    image(key, 0),
  );
});

describe('appendProductImage', () => {
  it('appends to the gallery and deletes nothing', async () => {
    const product = productWith('uploads/a.jpg', 'uploads/b.jpg');

    const stored = await appendProductImage(
      product,
      new Uint8Array([0xff, 0xd8, 0xff]),
      'image/jpeg',
    );

    // One atomic append, not a read-then-replace: the keys already on the
    // product are never restated, which is what made two racing uploads able
    // to overwrite each other.
    expect(setImages).not.toHaveBeenCalled();
    expect(appendImage).toHaveBeenCalledWith(
      PRODUCT_ID,
      stored?.objectKey,
      MAX_PRODUCT_IMAGES,
    );
    // The whole point: the two photos already on the product keep their files.
    expect(deletedKeys()).toEqual([]);
    expect(stored?.objectKey).toMatch(/^uploads\/[0-9a-f-]{36}\.jpg$/);
  });

  it('reports a driver that cannot take the refused file back', async () => {
    // The sibling catch in `setProductImageOrder` is pinned; this one was not,
    // so deleting it left the suite green while a driver failure turned an
    // ordinary 400 into an unhandled rejection — on the one path that is
    // already recovering from a race, with the orphan still on disk.
    appendImage.mockResolvedValue('full');
    remove.mockRejectedValue(new Error('disk gone'));

    const stored = await appendProductImage(
      productWith('uploads/a.jpg'),
      new Uint8Array([0xff, 0xd8, 0xff]),
      'image/jpeg',
    );

    expect(stored).toBeNull();
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('takes its own file back out when the gallery filled up in flight', async () => {
    // The refusal lands after the bytes are written, and the only other
    // deleter works from `product_images` — so a file left here is one nothing
    // would ever collect.
    appendImage.mockResolvedValue('full');

    const stored = await appendProductImage(
      productWith('uploads/a.jpg'),
      new Uint8Array([0xff, 0xd8, 0xff]),
      'image/jpeg',
    );

    expect(stored).toBeNull();
    const written = put.mock.calls[0][0];
    expect(deletedKeys()).toEqual([written]);
    // And nothing that was already on the product.
    expect(deletedKeys()).not.toContain('uploads/a.jpg');
  });

  it('throws ProductGoneError, and takes its file back out, when the product went in flight', async () => {
    // Not «the gallery is full»: the route answers 404 for this one. The file
    // is already written either way, and nothing else would ever collect it.
    appendImage.mockResolvedValue('gone');

    await expect(
      appendProductImage(
        productWith('uploads/a.jpg'),
        new Uint8Array([0xff, 0xd8, 0xff]),
        'image/jpeg',
      ),
    ).rejects.toBeInstanceOf(ProductGoneError);
    expect(deletedKeys()).toEqual([put.mock.calls[0][0]]);
  });

  it('stores the bytes under the server-generated key before recording it', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    const stored = await appendProductImage(productWith(), bytes, 'image/png');

    expect(put).toHaveBeenCalledWith(stored?.objectKey, bytes, 'image/png');
    expect(stored?.objectKey).toMatch(/^uploads\/[0-9a-f-]{36}\.png$/);
    expect(put.mock.invocationCallOrder[0]).toBeLessThan(
      appendImage.mock.invocationCallOrder[0],
    );
  });

  it('leaves a seeded product’s bundled asset alone when a photo is added', async () => {
    await appendProductImage(
      productWith('products/mug.jpg'),
      new Uint8Array([0xff, 0xd8, 0xff]),
      'image/jpeg',
    );

    expect(deletedKeys()).toEqual([]);
    // Untouched: an append names only its own key, so a bundled asset cannot
    // be caught up in it at all.
    expect(setImages).not.toHaveBeenCalled();
  });
});

describe('setProductImageOrder', () => {
  it('deletes nothing when the admin only reorders', async () => {
    const product = productWith('uploads/a.jpg', 'uploads/b.jpg');

    const stored = await setProductImageOrder(product, [
      'uploads/b.jpg',
      'uploads/a.jpg',
    ]);

    expect(setImages).toHaveBeenCalledWith(PRODUCT_ID, [
      'uploads/b.jpg',
      'uploads/a.jpg',
    ]);
    expect(deletedKeys()).toEqual([]);
    expect(stored?.map((one) => one.objectKey)).toEqual([
      'uploads/b.jpg',
      'uploads/a.jpg',
    ]);
  });

  it('throws ProductGoneError and deletes nothing when the product went before the write', async () => {
    // The DAO locks the product row first and answers null when it is gone —
    // deleted between the route's read and this write. The route makes it 404.
    const product = productWith('uploads/a.jpg', 'uploads/b.jpg');
    setImages.mockResolvedValueOnce(null);

    await expect(
      setProductImageOrder(product, ['uploads/a.jpg']),
    ).rejects.toBeInstanceOf(ProductGoneError);
    expect(deletedKeys()).toEqual([]);
  });

  it('deletes the removed photo and no other', async () => {
    const product = productWith(
      'uploads/a.jpg',
      'uploads/b.jpg',
      'uploads/c.jpg',
    );

    await setProductImageOrder(product, ['uploads/a.jpg', 'uploads/c.jpg']);

    expect(deletedKeys()).toEqual(['uploads/b.jpg']);
  });

  it('deletes every dropped file when the admin clears the gallery', async () => {
    const product = productWith('uploads/a.jpg', 'uploads/b.jpg');

    await setProductImageOrder(product, []);

    expect(setImages).toHaveBeenCalledWith(PRODUCT_ID, []);
    expect(deletedKeys().sort()).toEqual(['uploads/a.jpg', 'uploads/b.jpg']);
  });

  it('never hands a bundled `products/…` key to the driver, kept or dropped', async () => {
    const product = productWith(
      'products/mug.jpg',
      'uploads/a.jpg',
      'uploads/b.jpg',
    );

    // The seed asset stays on the product, reordered to the end; one upload is
    // dropped. Only the dropped upload may be deleted.
    await setProductImageOrder(product, ['uploads/a.jpg', 'products/mug.jpg']);

    expect(deletedKeys()).toEqual(['uploads/b.jpg']);
  });

  it('never deletes a bundled asset the admin removed either', async () => {
    const product = productWith('products/mug.jpg', 'uploads/a.jpg');

    await setProductImageOrder(product, ['uploads/a.jpg']);

    // The row goes; the committed file in `public/` is not ours to delete, and
    // the local driver would refuse it anyway — the filter is what makes that
    // refusal never fire rather than fire and be swallowed.
    expect(deletedKeys()).toEqual([]);
  });

  it('deletes a photo that arrived after the caller read the product', async () => {
    // The race this module was rewritten for. The route read `[a]`; an upload
    // appended `raced` and committed; the admin's save then replaces the list
    // with `[a]`, which deletes BOTH rows. A delete set diffed from the
    // caller's snapshot would not contain `raced`, so its file would stay on
    // disk with no row — and this loop, which works from the rows, is the only
    // thing that would ever have collected it.
    const product = productWith('uploads/a.jpg');
    previousKeys = ['uploads/a.jpg', 'uploads/raced.jpg'];

    await setProductImageOrder(product, ['uploads/a.jpg']);

    expect(deletedKeys()).toEqual(['uploads/raced.jpg']);
  });

  it('survives a driver that cannot delete', async () => {
    remove.mockRejectedValue(new Error('disk gone'));

    const stored = await setProductImageOrder(
      productWith('uploads/a.jpg', 'uploads/b.jpg'),
      ['uploads/a.jpg'],
    );

    // An orphaned file is housekeeping, never a reason to fail a write the
    // database already took.
    expect(stored?.map((one) => one.objectKey)).toEqual(['uploads/a.jpg']);
    // Surviving it silently is the bug: an orphan nothing will ever collect is
    // invisible until the bucket bill says otherwise.
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  describe('ownership', () => {
    it.each([
      ['another product’s upload', 'uploads/somebody-else.jpg'],
      ['a bundled asset this product does not have', 'products/kettle.jpg'],
      ['an arbitrary string', '../../etc/passwd'],
    ])('refuses %s and writes nothing', async (_name, foreign) => {
      const product = productWith('uploads/a.jpg', 'uploads/b.jpg');

      const stored = await setProductImageOrder(product, [
        'uploads/a.jpg',
        foreign,
      ]);

      expect(stored).toBeNull();
      expect(setImages).not.toHaveBeenCalled();
      expect(deletedKeys()).toEqual([]);
    });
  });
});
