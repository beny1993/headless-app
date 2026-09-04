// Needs a live database — see src/db/test-db.ts. The account order-history read:
// owner-scoped, newest-first, with a per-order line count. Owner-scoping is the
// security-critical part (a customer sees only their own orders), so it cannot be
// proven against a mocked db.
import { afterEach, describe, expect, it } from 'vitest';
import { databaseReachable, importWithDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));

describe.skipIf(!databaseReachable)('OrderDao.listByUser', () => {
  const fx = new OrderFixtures();
  afterEach(() => fx.cleanup());

  it('returns an empty list for a user with no orders', async () => {
    const user = await fx.user();
    expect(await OrderDao.listByUser(user.id)).toEqual([]);
  });

  it('lists only the caller’s orders, each with its line-item count', async () => {
    const owner = await fx.user();
    const other = await fx.user();
    const category = await fx.category();
    const productA = await fx.product(category, { price: 100_000, stock: 20 });
    const productB = await fx.product(category, { price: 200_000, stock: 20 });

    const first = await OrderDao.create(
      fx.buildOrder(owner, [{ product: productA, qty: 2 }]),
    );
    fx.remember(first.id);
    const second = await OrderDao.create(
      fx.buildOrder(owner, [
        { product: productA, qty: 1 },
        { product: productB, qty: 1 },
      ]),
    );
    fx.remember(second.id);
    const foreign = await OrderDao.create(
      fx.buildOrder(other, [{ product: productA, qty: 1 }]),
    );
    fx.remember(foreign.id);

    const list = await OrderDao.listByUser(owner.id);

    // Owner-scoped: the other user's order is absent.
    expect(list.map((o) => o.id).sort()).toEqual([first.id, second.id].sort());
    // Newest first: `second` was created after `first`.
    expect(list[0].id).toBe(second.id);
    // Per-order line count (distinct items).
    const byId = new Map(list.map((o) => [o.id, o]));
    expect(byId.get(first.id)!.itemCount).toBe(1);
    expect(byId.get(second.id)!.itemCount).toBe(2);
    expect(byId.get(second.id)!.total).toBe(second.total);
  });

  it('does not leak orders across users', async () => {
    const a = await fx.user();
    const b = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 10 });
    const order = await OrderDao.create(fx.buildOrder(a, [{ product }]));
    fx.remember(order.id);

    expect(await OrderDao.listByUser(b.id)).toEqual([]);
  });
});
