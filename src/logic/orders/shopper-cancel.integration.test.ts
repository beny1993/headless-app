// Needs a live database — see src/db/test-db.ts. A shopper's own cancel: only
// their own order (anyone else's is not found, never forbidden), only while
// it is open — waiting for its receipt or its online payment, the orders the
// checkout's open-order cap counts — and with the stock it reserved returned
// and a reason both the shopper and the admin read.
import { afterEach, describe, expect, it } from 'vitest';
import {
  ORDER_STATUS_VALUES,
  ORDER_STATUSES,
  OPEN_ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type OrderStatus,
} from '@/lib/orders/order-status';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const { shopperCancelOrder, SHOPPER_CANCEL_REASON } = await importWithDb(
  () => import('@/logic/orders/shopper-cancel'),
);
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));
const { PaymentDao } = await importWithDb(() => import('@/db/dao/PaymentDao'));

describe.skipIf(!databaseReachable)('shopperCancelOrder', () => {
  const fx = new OrderFixtures();
  afterEach(() => fx.cleanup());

  const placed = async (status: OrderStatus) => {
    const user = await fx.user();
    const product = await fx.product(await fx.category(), { stock: 3 });
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 2 }], {
        status,
        paymentMethod:
          status === ORDER_STATUSES.PENDING_PAYMENT
            ? PAYMENT_METHODS.ZARINPAL
            : PAYMENT_METHODS.COD,
      }),
    );
    fx.remember(order.id);
    return { user, product, order };
  };
  const stockOf = async (id: string) =>
    (await ProductDao.getByIds(testDb, [id]))[0].stock;

  it.each(OPEN_ORDER_STATUSES)(
    'cancels the shopper’s own %s order, returns its stock and says why',
    async (status) => {
      const { user, product, order } = await placed(status);

      expect(await shopperCancelOrder(order.id, user.id)).toEqual({
        outcome: 'ok',
      });

      const after = await OrderDao.getById(order.id);
      expect(after?.status).toBe(ORDER_STATUSES.CANCELLED);
      expect(after?.cancellationReason).toBe(SHOPPER_CANCEL_REASON);
      expect(await stockOf(product.id)).toBe(3 + 2);
    },
  );

  it('answers not found for another shopper’s order, and leaves it be (IDOR)', async () => {
    const { product, order } = await placed(ORDER_STATUSES.AWAITING_RECEIPT);
    const stranger = await fx.user();

    expect(await shopperCancelOrder(order.id, stranger.id)).toEqual({
      outcome: 'not_found',
    });
    expect((await OrderDao.getById(order.id))?.status).toBe(
      ORDER_STATUSES.AWAITING_RECEIPT,
    );
    expect(await stockOf(product.id)).toBe(3);
  });

  it('answers not found for an order that does not exist', async () => {
    const user = await fx.user();
    expect(await shopperCancelOrder(crypto.randomUUID(), user.id)).toEqual({
      outcome: 'not_found',
    });
  });

  it.each(
    ORDER_STATUS_VALUES.filter(
      (status) => !OPEN_ORDER_STATUSES.includes(status),
    ),
  )(
    'refuses a %s order, which has left the shopper’s hands',
    async (status) => {
      const { user, product, order } = await placed(status);

      expect(await shopperCancelOrder(order.id, user.id)).toEqual({
        outcome: 'not_allowed',
      });
      expect((await OrderDao.getById(order.id))?.status).toBe(status);
      expect(await stockOf(product.id)).toBe(3);
    },
  );

  it('cancels once when two cancels race, returning the stock once', async () => {
    const { user, product, order } = await placed(
      ORDER_STATUSES.AWAITING_RECEIPT,
    );

    const outcomes = await Promise.all([
      shopperCancelOrder(order.id, user.id),
      shopperCancelOrder(order.id, user.id),
    ]);

    expect(outcomes.map((o) => o.outcome).sort()).toEqual([
      'not_allowed',
      'ok',
    ]);
    expect(await stockOf(product.id)).toBe(3 + 2);
  });

  it('refuses while an online payment is still going through, and moves nothing', async () => {
    // The shopper may have paid at the gateway without coming back: a cancel
    // now would leave money taken on a cancelled order.
    const { user, product, order } = await placed(
      ORDER_STATUSES.PENDING_PAYMENT,
    );
    await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      status: PAYMENT_STATUSES.PENDING,
      amount: order.total,
      authority: `A-test-${crypto.randomUUID()}`,
    });

    expect(await shopperCancelOrder(order.id, user.id)).toEqual({
      outcome: 'payment_pending',
    });
    expect((await OrderDao.getById(order.id))?.status).toBe(
      ORDER_STATUSES.PENDING_PAYMENT,
    );
    expect(await stockOf(product.id)).toBe(3);
  });

  it('still cancels a card-to-card order, whose own payment row waits until delivery', async () => {
    const { user, order } = await placed(ORDER_STATUSES.AWAITING_RECEIPT);
    await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.COD,
      status: PAYMENT_STATUSES.PENDING,
      amount: order.total,
    });

    expect(await shopperCancelOrder(order.id, user.id)).toEqual({
      outcome: 'ok',
    });
  });
});
