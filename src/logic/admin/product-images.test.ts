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

const { setImages, put, remove, url, captureException } = vi.hoisted(() => ({
  setImages: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  url: vi.fn((key: string) => `/${key}`),
  captureException: vi.fn(),
}));
vi.mock('@sentry/nextjs', () => ({ captureException }));
vi.mock('@/db/dao/ProductDao', () => ({ ProductDao: { setImages } }));
vi.mock('@/lib/storage', () => ({
  getStorageDriver: () => ({ put, delete: remove, url }),
}));

import { appendProductImage, setProductImageOrder } from './product-images';

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
const productWith = (...keys: string[]): ProductWithImages =>
  ({
    id: PRODUCT_ID,
    images: keys.map(image),
  }) as unknown as ProductWithImages;

/** Every key handed to `driver.delete`, in call order. */
const deletedKeys = () => remove.mock.calls.map(([key]) => key);

beforeEach(() => {
  vi.clearAllMocks();
  remove.mockResolvedValue(undefined);
  put.mockResolvedValue(undefined);
  // The DAO replaces the gallery wholesale and returns what it stored, so the
  // fake answers with rows in the order it was given — which is also what makes
  // the returned `sortOrder` assertable.
  setImages.mockImplementation(async (_id: string, keys: string[]) =>
    keys.map(image),
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

    expect(setImages).toHaveBeenCalledWith(PRODUCT_ID, [
      'uploads/a.jpg',
      'uploads/b.jpg',
      stored.objectKey,
    ]);
    // The whole point: the two photos already on the product keep their files.
    expect(deletedKeys()).toEqual([]);
    expect(stored.sortOrder).toBe(2);
    expect(stored.objectKey).toMatch(/^uploads\/[0-9a-f-]{36}\.jpg$/);
  });

  it('stores the bytes under the server-generated key before recording it', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    const stored = await appendProductImage(productWith(), bytes, 'image/png');

    expect(put).toHaveBeenCalledWith(stored.objectKey, bytes, 'image/png');
    expect(stored.objectKey).toMatch(/^uploads\/[0-9a-f-]{36}\.png$/);
    expect(put.mock.invocationCallOrder[0]).toBeLessThan(
      setImages.mock.invocationCallOrder[0],
    );
  });

  it('leaves a seeded product’s bundled asset alone when a photo is added', async () => {
    await appendProductImage(
      productWith('products/cat-dry-food.jpg'),
      new Uint8Array([0xff, 0xd8, 0xff]),
      'image/jpeg',
    );

    expect(deletedKeys()).toEqual([]);
    expect(setImages.mock.calls[0][1][0]).toBe('products/cat-dry-food.jpg');
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
      'products/cat-dry-food.jpg',
      'uploads/a.jpg',
      'uploads/b.jpg',
    );

    // The seed asset stays on the product, reordered to the end; one upload is
    // dropped. Only the dropped upload may be deleted.
    await setProductImageOrder(product, [
      'uploads/a.jpg',
      'products/cat-dry-food.jpg',
    ]);

    expect(deletedKeys()).toEqual(['uploads/b.jpg']);
  });

  it('never deletes a bundled asset the admin removed either', async () => {
    const product = productWith('products/cat-dry-food.jpg', 'uploads/a.jpg');

    await setProductImageOrder(product, ['uploads/a.jpg']);

    // The row goes; the committed file in `public/` is not ours to delete, and
    // the local driver would refuse it anyway — the filter is what makes that
    // refusal never fire rather than fire and be swallowed.
    expect(deletedKeys()).toEqual([]);
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
      ['a bundled asset this product does not have', 'products/dog-toy.jpg'],
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
