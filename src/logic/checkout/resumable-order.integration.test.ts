// Needs a live database — see src/db/test-db.ts. The order `/checkout` picks
// back up after a reload: the shopper's own card-to-card order still waiting
// for its receipt inside the wait — their latest, or the one the URL names.
// Anything else (someone else's, accepted, cancelled, past the wait) is not
// resumable, and the checkout behaves as if there were none.
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { orders } from '@/db/schema/orders';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type OrderStatus,
} from '@/lib/orders/order-status';
import { RECEIPT_WAIT_MS } from '@/lib/orders/receipt';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import type { User } from '@/db/schema/auth';

const { findResumableReceiptOrder } = await importWithDb(
  () => import('@/logic/checkout/resumable-order'),
);
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));

const MINUTE_MS = 60 * 1000;

describe.skipIf(!databaseReachable)('findResumableReceiptOrder', () => {
  const fx = new OrderFixtures();
  afterEach(() => fx.cleanup());

  /** A card-to-card order of `user`'s, created `ageMs` ago. */
  const placed = async (
    user: User,
    { status = ORDER_STATUSES.AWAITING_RECEIPT, ageMs = 0 } = {} as {
      status?: OrderStatus;
      ageMs?: number;
    },
  ) => {
    const product = await fx.product(await fx.category());
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 2 }], {
        status,
        paymentMethod: PAYMENT_METHODS.COD,
      }),
    );
    fx.remember(order.id);
    await testDb
      .update(orders)
      .set({ createdAt: new Date(Date.now() - ageMs) })
      .where(eq(orders.id, order.id));
    return order;
  };

  it('finds the shopper’s latest order still waiting, with its lines', async () => {
    const user = await fx.user();
    await placed(user, { ageMs: 10 * MINUTE_MS });
    const latest = await placed(user, { ageMs: MINUTE_MS });

    const found = await findResumableReceiptOrder(user.id);

    expect(found?.id).toBe(latest.id);
    expect(found?.items).toHaveLength(1);
    expect(found?.items[0].qty).toBe(2);
  });

  it('resumes the order the URL names while it is still the shopper’s and waiting', async () => {
    const user = await fx.user();
    const older = await placed(user, { ageMs: 10 * MINUTE_MS });
    await placed(user, { ageMs: MINUTE_MS });

    expect((await findResumableReceiptOrder(user.id, older.id))?.id).toBe(
      older.id,
    );
  });

  it('never resumes another shopper’s order (IDOR)', async () => {
    const owner = await fx.user();
    const stranger = await fx.user();
    const order = await placed(owner);

    expect(await findResumableReceiptOrder(stranger.id)).toBeNull();
    expect(await findResumableReceiptOrder(stranger.id, order.id)).toBeNull();
  });

  it('leaves an order past its wait — the sweep is cancelling it', async () => {
    const user = await fx.user();
    const order = await placed(user, { ageMs: RECEIPT_WAIT_MS + MINUTE_MS });

    expect(await findResumableReceiptOrder(user.id)).toBeNull();
    expect(await findResumableReceiptOrder(user.id, order.id)).toBeNull();
  });

  it.each([ORDER_STATUSES.PROCESSING, ORDER_STATUSES.CANCELLED])(
    'leaves a %s order, which takes no receipt from the checkout',
    async (status) => {
      const user = await fx.user();
      const order = await placed(user, { status });

      expect(await findResumableReceiptOrder(user.id)).toBeNull();
      expect(await findResumableReceiptOrder(user.id, order.id)).toBeNull();
    },
  );

  it('finds nothing for a shopper with no order waiting', async () => {
    expect(await findResumableReceiptOrder((await fx.user()).id)).toBeNull();
  });
});
