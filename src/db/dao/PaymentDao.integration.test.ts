// Needs a live database — see src/db/test-db.ts. The authority-uniqueness and
// amount constraints are enforced by Postgres, so they can only be proven here.
import { afterEach, describe, expect, it } from 'vitest';
import { PAYMENT_METHODS, PAYMENT_STATUSES } from '@/lib/orders/order-status';
import { databaseReachable, importWithDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import type { OrderWithItems } from '@/db/schema/orders';

const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { PaymentDao } = await importWithDb(() => import('@/db/dao/PaymentDao'));

describe.skipIf(!databaseReachable)('PaymentDao', () => {
  const fx = new OrderFixtures();
  afterEach(() => fx.cleanup());

  const orderFor = async (): Promise<OrderWithItems> => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { stock: 10 });
    const order = await OrderDao.create(fx.buildOrder(user, [{ product }]));
    fx.remember(order.id);
    return order;
  };

  const refusedBy = async (
    run: () => Promise<unknown>,
  ): Promise<string | undefined> => {
    try {
      await run();
      return undefined;
    } catch (error) {
      return (error as { cause?: { constraint?: string } }).cause?.constraint;
    }
  };

  it('stores a Zarinpal attempt and finds it by authority', async () => {
    const order = await orderFor();
    const authority = `A-${crypto.randomUUID()}`;

    const created = await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      amount: order.total,
      authority,
    });

    expect(created.status).toBe(PAYMENT_STATUSES.PENDING); // column default
    const found = await PaymentDao.getByAuthority(authority);
    expect(found?.id).toBe(created.id);
  });

  it('rejects a second row with the same authority — the idempotency anchor', async () => {
    const order = await orderFor();
    const authority = `A-${crypto.randomUUID()}`;
    await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      amount: order.total,
      authority,
    });

    const refused = await refusedBy(() =>
      PaymentDao.create({
        orderId: order.id,
        method: PAYMENT_METHODS.ZARINPAL,
        amount: order.total,
        authority,
      }),
    );

    expect(refused).toBe('payments_authority_unique');
  });

  it('allows many COD rows with a null authority (unique permits repeated NULLs)', async () => {
    const first = await orderFor();
    const second = await orderFor();

    const a = await PaymentDao.create({
      orderId: first.id,
      method: PAYMENT_METHODS.COD,
      amount: first.total,
    });
    const b = await PaymentDao.create({
      orderId: second.id,
      method: PAYMENT_METHODS.COD,
      amount: second.total,
    });

    expect(a.authority).toBeNull();
    expect(b.authority).toBeNull();
  });

  it('lists every attempt on an order', async () => {
    const order = await orderFor();
    await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      amount: order.total,
      authority: `A-${crypto.randomUUID()}`,
    });
    await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.ZARINPAL,
      amount: order.total,
      authority: `A-${crypto.randomUUID()}`,
    });

    expect(await PaymentDao.listByOrder(order.id)).toHaveLength(2);
  });

  it('rejects a negative amount but allows zero (a fully-discounted order)', async () => {
    const order = await orderFor();

    const refused = await refusedBy(() =>
      PaymentDao.create({
        orderId: order.id,
        method: PAYMENT_METHODS.COD,
        amount: -1,
      }),
    );
    expect(refused).toBe('payments_amount_non_negative');

    const zero = await PaymentDao.create({
      orderId: order.id,
      method: PAYMENT_METHODS.COD,
      amount: 0,
    });
    expect(zero.amount).toBe(0);
  });
});
