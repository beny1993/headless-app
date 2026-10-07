// Needs a live database — see src/db/test-db.ts. The admin's 🗑 decides between
// a real delete and a deactivation, and the database is what makes that
// decision safe: both `order_items.product_id` and `products.variant_of`
// restrict, so only Postgres can prove the fallback holds when the check and
// the delete disagree.
//
// The storage driver is a recorder: the assertion is on the keys handed to
// `delete`, so a bundled `products/…` asset reaching it fails here rather than
// as a swallowed refusal from the local driver.
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  categories,
  productCategories,
  productImages,
  products,
  type Category,
  type Product,
} from '@/db/schema/catalog';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import {
  DELETE_INTENTS,
  DELETE_OUTCOMES,
  HARD_DELETE_BLOCKERS,
} from '@/lib/catalog/product-delete';
import { hasMembersMessage } from '@/lib/catalog/variant';
import { RECEIPT_KEY_PREFIX } from '@/lib/storage/image-upload';

const { remove } = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  getStorageDriver: () => ({
    put: vi.fn(),
    delete: remove,
    url: (key: string) => `/${key}`,
  }),
}));

const { removeProduct, hardDeleteBlockers } = await importWithDb(
  () => import('./product-removal'),
);
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));

describe.skipIf(!databaseReachable)(
  'removing a product from the admin list',
  () => {
    const fx = new OrderFixtures();
    const memberIds: string[] = [];

    beforeEach(() => {
      remove.mockReset();
      remove.mockResolvedValue(undefined);
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      // Members first: `variant_of` restricts, so a head cannot go while one of
      // its members is still there.
      if (memberIds.length > 0) {
        await testDb.delete(products).where(inArray(products.id, memberIds));
        memberIds.length = 0;
      }
      await fx.cleanup();
    });

    const member = async (
      category: Category,
      head: Product,
      over: Partial<Product> = {},
    ) => {
      const row = await fx.product(category, {
        variantOf: head.id,
        variantLabel: 'اقیانوس',
        ...over,
      });
      memberIds.push(row.id);
      return row;
    };

    const headOf = async (category: Category) =>
      fx.product(category, { variantLabel: 'لاوندر' });

    const order = async (product: Product) => {
      const user = await fx.user();
      const created = await OrderDao.create(
        fx.buildOrder(user, [{ product }]) as Parameters<
          typeof OrderDao.create
        >[0],
      );
      fx.remember(created.id);
    };

    const photos = (product: Product, keys: string[]) =>
      testDb.insert(productImages).values(
        keys.map((objectKey, sortOrder) => ({
          productId: product.id,
          objectKey,
          sortOrder,
        })),
      );

    const rowOf = async (id: string) =>
      (await testDb.select().from(products).where(eq(products.id, id)))[0];

    const imageKeysOf = async (id: string) =>
      (
        await testDb
          .select({ objectKey: productImages.objectKey })
          .from(productImages)
          .where(eq(productImages.productId, id))
      ).map((row) => row.objectKey);

    describe('removeProduct', () => {
      it('deletes a product nothing references, with its images and extra categories', async () => {
        const category = await fx.category();
        const extra = await fx.category();
        const product = await fx.product(category);
        await testDb
          .insert(productCategories)
          .values({ productId: product.id, categoryId: extra.id });
        await photos(product, ['uploads/a.jpg']);

        expect(await removeProduct(product.id, DELETE_INTENTS.DELETE)).toBe(
          DELETE_OUTCOMES.DELETED,
        );

        expect(await rowOf(product.id)).toBeUndefined();
        expect(await imageKeysOf(product.id)).toEqual([]);
        expect(
          await testDb
            .select()
            .from(productCategories)
            .where(eq(productCategories.productId, product.id)),
        ).toEqual([]);
        // Nothing downstream still finds it: the storefront page reads as absent
        // (its URL 404s) and the sitemap leaves it out.
        expect(await ProductDao.getBySlug(product.slug)).toBeNull();
        expect(
          (await ProductDao.listForSitemap()).map((entry) => entry.slug),
        ).not.toContain(product.slug);
        // The extra category is free again: the junction row went with it.
        await testDb.delete(categories).where(eq(categories.id, extra.id));
      });

      it('deletes an inactive product nothing references, so an old mistake can be cleaned up', async () => {
        const category = await fx.category();
        const product = await fx.product(category, { isActive: false });

        expect(await removeProduct(product.id, DELETE_INTENTS.DELETE)).toBe(
          DELETE_OUTCOMES.DELETED,
        );
        expect(await rowOf(product.id)).toBeUndefined();
      });

      it('deletes a family member nothing references, and leaves its head alone', async () => {
        const category = await fx.category();
        const head = await headOf(category);
        const one = await member(category, head);

        expect(await removeProduct(one.id, DELETE_INTENTS.DELETE)).toBe(
          DELETE_OUTCOMES.DELETED,
        );
        expect(await rowOf(one.id)).toBeUndefined();
        expect((await rowOf(head.id)).isActive).toBe(true);
      });

      it('deactivates an ordered product and keeps its row and its photos', async () => {
        const category = await fx.category();
        const product = await fx.product(category);
        await photos(product, ['uploads/ordered.jpg']);
        await order(product);

        expect(await removeProduct(product.id, DELETE_INTENTS.DELETE)).toBe(
          DELETE_OUTCOMES.DEACTIVATED,
        );

        expect((await rowOf(product.id)).isActive).toBe(false);
        expect(await imageKeysOf(product.id)).toEqual(['uploads/ordered.jpg']);
        expect(remove).not.toHaveBeenCalled();
      });

      it('deactivates a head whose members are all inactive', async () => {
        // The members still point at it, and `variant_of` restricts: a delete
        // would fail, so the head is only hidden — as it was before this story.
        const category = await fx.category();
        const head = await headOf(category);
        await member(category, head, { isActive: false });

        expect(await removeProduct(head.id, DELETE_INTENTS.DELETE)).toBe(
          DELETE_OUTCOMES.DEACTIVATED,
        );
        expect((await rowOf(head.id)).isActive).toBe(false);
      });

      it.each([DELETE_INTENTS.DELETE, DELETE_INTENTS.DEACTIVATE])(
        'refuses a head with active members, as the soft delete always has (%s)',
        async (intent) => {
          const category = await fx.category();
          const head = await headOf(category);
          await member(category, head);

          await expect(removeProduct(head.id, intent)).rejects.toThrow(
            hasMembersMessage(1),
          );
          // A refusal that half-applied would be worse than one that did not fire.
          expect((await rowOf(head.id)).isActive).toBe(true);
        },
      );

      it('only deactivates when that is all the admin confirmed, even if it could be deleted', async () => {
        // The modal read a blocker that has since gone, and the server must
        // never do more than the admin confirmed.
        const category = await fx.category();
        const product = await fx.product(category);
        await photos(product, ['uploads/kept.jpg']);

        expect(await removeProduct(product.id, DELETE_INTENTS.DEACTIVATE)).toBe(
          DELETE_OUTCOMES.DEACTIVATED,
        );

        expect((await rowOf(product.id)).isActive).toBe(false);
        expect(await imageKeysOf(product.id)).toEqual(['uploads/kept.jpg']);
        expect(remove).not.toHaveBeenCalled();
      });

      it('answers null for an unknown id', async () => {
        expect(
          await removeProduct(crypto.randomUUID(), DELETE_INTENTS.DELETE),
        ).toBeNull();
      });

      it('falls back to deactivating when the delete hits a foreign key the check missed', async () => {
        // The check and the delete run under the row lock, so an order landing
        // in between is already shut out — but the fallback must hold on its
        // own. Make the check lie: it reports no orders for a product that has
        // one, so the DELETE reaches Postgres and gets its 23503.
        const category = await fx.category();
        const product = await fx.product(category);
        await photos(product, ['uploads/raced.jpg']);
        await order(product);
        vi.spyOn(OrderDao, 'orderedProductIds').mockResolvedValue(new Set());

        expect(await removeProduct(product.id, DELETE_INTENTS.DELETE)).toBe(
          DELETE_OUTCOMES.DEACTIVATED,
        );

        // The deactivation ran in the same transaction after the failed delete,
        // and the images the delete took first came back with its savepoint.
        expect((await rowOf(product.id)).isActive).toBe(false);
        expect(await imageKeysOf(product.id)).toEqual(['uploads/raced.jpg']);
        expect(remove).not.toHaveBeenCalled();
      });

      it('deletes only the uploaded files, never a bundled asset or a receipt', async () => {
        // A receipt's key never belongs on a product, but if one ever did, the
        // filter is what keeps the order's proof of payment from being deleted.
        const receiptKey = `${RECEIPT_KEY_PREFIX}/${crypto.randomUUID()}.jpg`;
        const category = await fx.category();
        const product = await fx.product(category);
        await photos(product, [
          'uploads/one.jpg',
          'products/cat-dry-food.jpg',
          receiptKey,
          'uploads/two.webp',
        ]);

        expect(await removeProduct(product.id, DELETE_INTENTS.DELETE)).toBe(
          DELETE_OUTCOMES.DELETED,
        );

        expect(remove.mock.calls.map(([key]) => key).sort()).toEqual([
          'uploads/one.jpg',
          'uploads/two.webp',
        ]);
      });

      it('still answers deleted when a file fails to go — the row is already gone', async () => {
        const category = await fx.category();
        const product = await fx.product(category);
        await photos(product, ['uploads/stuck.jpg']);
        remove.mockRejectedValue(new Error('EACCES'));
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        expect(await removeProduct(product.id, DELETE_INTENTS.DELETE)).toBe(
          DELETE_OUTCOMES.DELETED,
        );
        expect(await rowOf(product.id)).toBeUndefined();
      });
    });

    describe('hardDeleteBlockers', () => {
      it('names what keeps each product from being deleted, and nothing for the rest', async () => {
        const category = await fx.category();
        const plain = await fx.product(category);
        const ordered = await fx.product(category, { isActive: false });
        await order(ordered);
        const head = await headOf(category);
        const one = await member(category, head, { isActive: false });
        const orderedHead = await headOf(category);
        await member(category, orderedHead);
        await order(orderedHead);

        const blockers = await hardDeleteBlockers([
          plain.id,
          ordered.id,
          head.id,
          one.id,
          orderedHead.id,
        ]);

        expect(Object.fromEntries(blockers)).toEqual({
          [ordered.id]: HARD_DELETE_BLOCKERS.ORDERS,
          [head.id]: HARD_DELETE_BLOCKERS.MEMBERS,
          // Both: the orders are the reason that never goes away.
          [orderedHead.id]: HARD_DELETE_BLOCKERS.ORDERS,
        });
      });

      it('reads the whole page in one query per table, not one per row', async () => {
        const category = await fx.category();
        const ids = [
          (await fx.product(category)).id,
          (await fx.product(category)).id,
          (await fx.product(category)).id,
        ];
        const ordersRead = vi.spyOn(OrderDao, 'orderedProductIds');
        const membersRead = vi.spyOn(ProductDao, 'idsWithMembers');

        await hardDeleteBlockers(ids);

        expect(ordersRead).toHaveBeenCalledTimes(1);
        expect(membersRead).toHaveBeenCalledTimes(1);
      });

      it('reads nothing for an empty page', async () => {
        const ordersRead = vi.spyOn(OrderDao, 'orderedProductIds');

        expect((await hardDeleteBlockers([])).size).toBe(0);
        expect(ordersRead).not.toHaveBeenCalled();
      });
    });
  },
);
