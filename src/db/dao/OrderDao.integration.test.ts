// Needs a live database — see src/db/test-db.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { ORDER_STATUSES } from '@/lib/orders/order-status';
import { databaseReachable, importWithDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';

const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));

describe.skipIf(!databaseReachable)('OrderDao', () => {
  const fx = new OrderFixtures();
  afterEach(() => fx.cleanup());

  const setup = async () => {
    const user = await fx.user();
    const category = await fx.category();
    const product = await fx.product(category, { price: 200_000, stock: 10 });
    return { user, product };
  };

  it('creates an order with its line items in one call', async () => {
    const { user, product } = await setup();

    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 3 }]),
    );
    fx.remember(order.id);

    expect(order.items).toHaveLength(1);
    expect(order.items[0].qty).toBe(3);
    expect(order.items[0].orderId).toBe(order.id);
    expect(order.status).toBe(ORDER_STATUSES.PENDING_PAYMENT);
  });

  it('snapshots title, sku and unit price so a later product change cannot rewrite it', async () => {
    const { user, product } = await setup();
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 2 }]),
    );
    fx.remember(order.id);
    const originalPrice = product.price;

    // The product is edited and re-priced after the order is placed.
    await ProductDao.update(product.id, {
      price: originalPrice + 500_000,
      title: 'عنوان جدید',
    });

    const reread = await OrderDao.getById(order.id);
    expect(reread?.items[0].unitPrice).toBe(originalPrice);
    expect(reread?.items[0].title).toBe(product.title);
    expect(reread?.items[0].sku).toBe(product.sku);
  });

  it('gives each order a distinct, increasing human-readable order_no', async () => {
    const { user, product } = await setup();

    const first = await OrderDao.create(fx.buildOrder(user, [{ product }]));
    fx.remember(first.id);
    const second = await OrderDao.create(fx.buildOrder(user, [{ product }]));
    fx.remember(second.id);

    expect(typeof first.orderNo).toBe('number');
    expect(second.orderNo).toBeGreaterThan(first.orderNo);
  });

  it('reads an order back by its uuid and by its order_no', async () => {
    const { user, product } = await setup();
    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product, qty: 2 }]),
    );
    fx.remember(order.id);

    const byId = await OrderDao.getById(order.id);
    const byNo = await OrderDao.getByOrderNo(order.orderNo);

    expect(byId?.id).toBe(order.id);
    expect(byNo?.id).toBe(order.id);
    expect(byNo?.items).toHaveLength(1);
  });

  it('returns null for an unknown id', async () => {
    expect(await OrderDao.getById(crypto.randomUUID())).toBeNull();
  });

  it('round-trips a billion-Toman total through bigint mode:number', async () => {
    const { user, product } = await setup();
    const total = 1_000_000_000;

    const order = await OrderDao.create(
      fx.buildOrder(user, [{ product }], {
        subtotal: total,
        shippingFee: 0,
        total,
      }),
    );
    fx.remember(order.id);

    const reread = await OrderDao.getById(order.id);
    expect(reread?.total).toBe(total);
    expect(reread?.subtotal).toBe(total);
    expect(reread?.createdAt).toBeInstanceOf(Date);
  });
});
