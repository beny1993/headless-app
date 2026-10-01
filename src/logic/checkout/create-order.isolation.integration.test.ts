// The checkout transaction's pinned isolation level. The account lock queues
// one account's checkouts, but the caps behind it are only right if every read
// after the wait sees what the checkout before it committed. Under a snapshot
// level the snapshot is taken at the lock, before the wait, so this suite runs
// on connections whose default is REPEATABLE READ and expects the caps to hold.
//
// PGOPTIONS reaches this file's connections only: node-postgres reads it each
// time the pool opens a client, and vitest (`isolate`, on by default) runs each
// test file in a worker process of its own and never hands that worker on.
// Needs a live database — see src/db/test-db.ts.
import { eq, inArray, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { orders } from '@/db/schema/orders';
import { provinces, shippingRates } from '@/db/schema/shipping';
import { PAYMENT_METHODS } from '@/lib/orders/order-status';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import type { CheckoutInput } from '@/lib/checkout/checkout-input';
import { CheckoutError } from '@/logic/checkout/checkout-error';

const mocks = vi.hoisted(() => {
  // Before any import opens a connection.
  process.env.PGOPTIONS = '-c default_transaction_isolation=repeatable\\ read';
  return { notify: vi.fn() };
});

// A burst of real checkouts must not reach the admins' phones.
vi.mock('@/logic/orders/notify-new-order', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/logic/orders/notify-new-order')>()),
  notifyAdminsOfNewOrder: mocks.notify,
}));

const { createOrder, MAX_OPEN_ORDERS } = await importWithDb(
  () => import('@/logic/checkout/create-order'),
);
const { ShippingRateDao } = await importWithDb(
  () => import('@/db/dao/ShippingRateDao'),
);

const token = () => crypto.randomUUID().slice(0, 12);

describe.skipIf(!databaseReachable)('createOrder isolation', () => {
  const fx = new OrderFixtures();
  const provinceIds: number[] = [];

  afterEach(async () => {
    // A burst that got past the cap leaves orders no test remembered, and
    // they would pin the product the cleanup below deletes.
    if (fx.userIds.length > 0) {
      await testDb.delete(orders).where(inArray(orders.userId, fx.userIds));
    }
    await fx.cleanup();
    if (provinceIds.length > 0) {
      await testDb
        .delete(shippingRates)
        .where(inArray(shippingRates.provinceId, provinceIds));
      await testDb.delete(provinces).where(inArray(provinces.id, provinceIds));
      provinceIds.length = 0;
    }
  });

  it('holds the open-order cap on connections that default to REPEATABLE READ', async () => {
    // Otherwise this passes on any database, pin or no pin.
    const { rows } = await testDb.execute(
      sql`show default_transaction_isolation`,
    );
    expect(rows).toEqual([
      { default_transaction_isolation: 'repeatable read' },
    ]);

    // Every checkout is born open — a card-to-card one waits for its receipt —
    // so a burst from one account meets the open-order cap first.
    const size = MAX_OPEN_ORDERS + 10;
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, {
      price: 100_000,
      stock: size,
    });
    const province = await ShippingRateDao.upsertProvinceWithRate({
      name: `استان آزمایشی-${token()}`,
      fee: 40_000,
    });
    provinceIds.push(province.provinceId);
    const input: CheckoutInput = {
      items: [{ productId: product.id, qty: 1 }],
      address: {
        recipientName: 'گیرنده آزمایشی',
        recipientPhone: '09120000000',
        provinceId: province.provinceId,
        city: 'تهران',
        postalCode: '1234567890',
        addressLine: 'خیابان آزمایشی، پلاک ۱',
      },
      paymentMethod: PAYMENT_METHODS.COD,
    };

    const results = await Promise.allSettled(
      Array.from({ length: size }, () =>
        createOrder(user.id, input, crypto.randomUUID()),
      ),
    );

    const created = await testDb
      .select()
      .from(orders)
      .where(eq(orders.userId, user.id));
    expect(created).toHaveLength(MAX_OPEN_ORDERS);
    const refused = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    expect(refused).toHaveLength(10);
    for (const error of refused) {
      expect(error).toBeInstanceOf(CheckoutError);
      expect(error.message).toContain('یکی را کامل یا لغو کنید');
    }
  });
});
