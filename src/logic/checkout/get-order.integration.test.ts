// Needs a live database — see src/db/test-db.ts. `getOwnedOrder` is the read
// behind GET /api/orders/:id: owner-scoped (a session alone is never
// authorization — customers get sessions too) and returning a PROJECTION that
// never leaks the gateway secrets on a payment row.
import { afterEach, describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '@/lib/orders/order-status';
import { productImages } from '@/db/schema/catalog';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const { getOwnedOrder } = await importWithDb(
  () => import('@/logic/checkout/get-order'),
);
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { PaymentDao } = await importWithDb(() => import('@/db/dao/PaymentDao'));

describe.skipIf(!databaseReachable)('getOwnedOrder', () => {
  const fx = new OrderFixtures();
  afterEach(() => fx.cleanup());

  /** A COD order owned by a fresh user, with a pending COD payment row. */
  const seedOrder = async () => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 5 });
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 2 }], {
        status: ORDER_STATUSES.PROCESSING,
        paymentMethod: PAYMENT_METHODS.COD,
      }),
    );
    fx.remember(order.id);
    return { user, order, product };
  };

  it('returns the owner’s order with its item snapshots', async () => {
    const { user, order, product } = await seedOrder();

    const result = await getOwnedOrder(order.id, user.id);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(order.id);
    expect(result!.orderNo).toBe(order.orderNo);
    expect(result!.items).toHaveLength(1);
    expect(result!.items[0].sku).toBe(product.sku);
  });

  it('gives each line its product’s first photo, and none when it has no photo', async () => {
    const { user, order, product } = await seedOrder();

    expect((await getOwnedOrder(order.id, user.id))!.items[0].imageKey).toBe(
      undefined,
    );

    await testDb
      .insert(productImages)
      .values({ productId: product.id, objectKey: 'uploads/line.jpg' });
    expect((await getOwnedOrder(order.id, user.id))!.items[0].imageKey).toBe(
      'uploads/line.jpg',
    );
  });

  it('returns null for another user’s order (IDOR — do not leak existence)', async () => {
    const { order } = await seedOrder();
    const other = await fx.user();

    expect(await getOwnedOrder(order.id, other.id)).toBeNull();
  });

  it('returns null for an id that does not exist', async () => {
    const user = await fx.user();
    expect(await getOwnedOrder(crypto.randomUUID(), user.id)).toBeNull();
  });

  it('projects payments to {method,status,paidAt} — never the gateway secrets', async () => {
    const { user, order } = await seedOrder();
    // A Zarinpal payment row carrying every sensitive field the projection must
    // drop (as story 15's verify callback would set them).
    await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      status: PAYMENT_STATUSES.PAID,
      amount: order.total,
      authority: 'A00000000000000000000000000000000001',
      refId: '987654321',
      cardPan: '6274-****-****-1234',
      gatewayResponse: { code: 100, message: 'ok' },
      failureReason: 'none',
      paidAt: new Date(),
    });

    const result = await getOwnedOrder(order.id, user.id);
    const zarinpal = result!.payments.find(
      (p) => p.method === PAYMENT_METHODS.ZARINPAL,
    )!;

    expect(Object.keys(zarinpal).sort()).toEqual([
      'method',
      'paidAt',
      'status',
    ]);
    // Belt and braces: none of the secrets appear anywhere in the serialized read.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('authority');
    expect(serialized).not.toContain('cardPan');
    expect(serialized).not.toContain('gatewayResponse');
    expect(serialized).not.toContain('failureReason');
    expect(serialized).not.toContain('6274-****-****-1234');
  });
});
