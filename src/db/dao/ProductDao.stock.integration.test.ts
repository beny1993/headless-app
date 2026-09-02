// Needs a live database — see src/db/test-db.ts. The oversell guard's whole
// point is behaviour under concurrency, which a mocked `db` cannot show. The rest
// of ProductDao's surface is covered in ./ProductDao.integration.test.ts; this
// file owns the stock-reservation primitives the orders story adds.
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { products } from '@/db/schema/catalog';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));

describe.skipIf(!databaseReachable)('ProductDao stock reservation', () => {
  const fx = new OrderFixtures();
  afterEach(() => fx.cleanup());

  const stockOf = async (id: string) => {
    const [row] = await testDb
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, id))
      .limit(1);
    return row.stock;
  };

  const seedProduct = async (stock: number) => {
    const category = await fx.category();
    return fx.product(category, { stock });
  };

  describe('decrementStock', () => {
    it('reserves stock when there is enough, returning the reduced row', async () => {
      const product = await seedProduct(5);

      const updated = await ProductDao.decrementStock(testDb, product.id, 3);

      expect(updated?.stock).toBe(2);
      expect(await stockOf(product.id)).toBe(2);
    });

    it('refuses and leaves stock untouched when there is not enough', async () => {
      const product = await seedProduct(2);

      const updated = await ProductDao.decrementStock(testDb, product.id, 3);

      expect(updated).toBeNull();
      expect(await stockOf(product.id)).toBe(2);
    });

    it('may take the last unit down to exactly zero', async () => {
      const product = await seedProduct(4);

      const updated = await ProductDao.decrementStock(testDb, product.id, 4);

      expect(updated?.stock).toBe(0);
    });

    it('never oversells under concurrency — 10 racers, 5 units', async () => {
      // The design's core invariant. Ten checkouts race for five units of one
      // qty each: exactly five may win, and stock must land at zero, never below.
      const product = await seedProduct(5);

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          ProductDao.decrementStock(testDb, product.id, 1),
        ),
      );

      const won = results.filter((row) => row !== null);
      expect(won).toHaveLength(5);
      expect(await stockOf(product.id)).toBe(0);
    });

    it('never lets two racing multi-unit reservations both win', async () => {
      // stock 5, two racers wanting 3 each: only one can be satisfied.
      const product = await seedProduct(5);

      const results = await Promise.all([
        ProductDao.decrementStock(testDb, product.id, 3),
        ProductDao.decrementStock(testDb, product.id, 3),
      ]);

      const won = results.filter((row) => row !== null);
      expect(won).toHaveLength(1);
      expect(await stockOf(product.id)).toBe(2);
    });

    it('rejects a non-positive qty rather than raising stock', async () => {
      const product = await seedProduct(5);

      await expect(
        ProductDao.decrementStock(testDb, product.id, 0),
      ).rejects.toThrow(/positive integer/);
      await expect(
        ProductDao.decrementStock(testDb, product.id, -2),
      ).rejects.toThrow(/positive integer/);
      expect(await stockOf(product.id)).toBe(5);
    });
  });

  describe('restock', () => {
    it('returns reserved stock to the product', async () => {
      const product = await seedProduct(5);
      await ProductDao.decrementStock(testDb, product.id, 4);

      const restocked = await ProductDao.restock(testDb, product.id, 4);

      expect(restocked?.stock).toBe(5);
    });

    it('rejects a non-positive qty', async () => {
      const product = await seedProduct(5);

      await expect(ProductDao.restock(testDb, product.id, 0)).rejects.toThrow(
        /positive integer/,
      );
    });
  });
});
