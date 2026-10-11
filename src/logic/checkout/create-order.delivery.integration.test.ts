// Courier delivery at checkout ([[Story - Courier Delivery at Checkout]]),
// against the real database:
//   · a courier order in Tehran snapshots no shipping fee — its total is the
//     items less the discount — and stores `delivery_method = 'courier'`;
//   · a courier order outside Tehran is refused before anything is reserved;
//   · a body with no method is a post order, priced exactly as before.
//
// Tehran is the row migration 0011 plants in every environment; the suite only
// reads it (its fee is never touched — the shared dev database's other suites
// and the shopper's browser both price from it).
import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { discountCodes } from '@/db/schema/discounts';
import { orders } from '@/db/schema/orders';
import { products as productsTable } from '@/db/schema/catalog';
import { provinces, shippingRates } from '@/db/schema/shipping';
import {
  COURIER_UNAVAILABLE,
  DELIVERY_METHODS,
} from '@/lib/orders/delivery-method';
import { DISCOUNT_TYPES } from '@/lib/discount/discount-code';
import { PAYMENT_METHODS } from '@/lib/orders/order-status';
import { CheckoutError } from '@/logic/checkout/checkout-error';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { OrderFixtures } from '@/db/order-test-fixtures';
import type { CheckoutInput } from '@/lib/checkout/checkout-input';

const { createOrder, ZERO_TOTAL_REFUSED } = await importWithDb(
  () => import('@/logic/checkout/create-order'),
);
const { DiscountCodeDao } = await importWithDb(
  () => import('@/db/dao/DiscountCodeDao'),
);
const { ShippingRateDao } = await importWithDb(
  () => import('@/db/dao/ShippingRateDao'),
);

const token = () => crypto.randomUUID().slice(0, 12);

describe.skipIf(!databaseReachable)('createOrder — delivery method', () => {
  const fx = new OrderFixtures();
  const provinceIds: number[] = [];
  const codeIds: string[] = [];

  afterEach(async () => {
    await fx.cleanup();
    if (codeIds.length > 0) {
      await testDb
        .delete(discountCodes)
        .where(inArray(discountCodes.id, codeIds));
      codeIds.length = 0;
    }
    if (provinceIds.length > 0) {
      await testDb
        .delete(shippingRates)
        .where(inArray(shippingRates.provinceId, provinceIds));
      await testDb.delete(provinces).where(inArray(provinces.id, provinceIds));
      provinceIds.length = 0;
    }
  });

  const tehran = async () => {
    const [row] = await testDb
      .select({ id: provinces.id })
      .from(provinces)
      .where(eq(provinces.name, 'تهران'))
      .limit(1);
    const rate = row && (await ShippingRateDao.getByProvinceId(row.id));
    if (!rate) throw new Error('migration 0011 should have planted Tehran');
    return rate;
  };

  const elsewhere = async () => {
    const row = await ShippingRateDao.upsertProvinceWithRate({
      name: `استان آزمایشی-${token()}`,
      fee: 60_000,
    });
    provinceIds.push(row.provinceId);
    return row;
  };

  const stockOf = async (id: string) => {
    const [row] = await testDb
      .select({ stock: productsTable.stock })
      .from(productsTable)
      .where(eq(productsTable.id, id))
      .limit(1);
    return row.stock;
  };

  const input = (
    provinceId: number,
    productId: string,
    overrides: Partial<CheckoutInput> = {},
  ): CheckoutInput => ({
    items: [{ productId, qty: 2 }],
    address: {
      recipientName: 'گیرنده آزمایشی',
      recipientPhone: '09120000000',
      provinceId,
      city: 'تهران',
      postalCode: '1234567890',
      addressLine: 'هروی، خیابان آزمایشی، پلاک ۱',
    },
    paymentMethod: PAYMENT_METHODS.COD,
    ...overrides,
  });

  it('a courier order in Tehran adds no shipping fee and stores the method', async () => {
    const user = await fx.user();
    const product = await fx.product(await fx.category(), {
      price: 120_000,
      stock: 5,
    });
    const rate = await tehran();
    expect(rate.fee).toBeGreaterThan(0); // else the zero below proves nothing

    const order = await createOrder(
      user.id,
      input(rate.provinceId, product.id, {
        deliveryMethod: DELIVERY_METHODS.COURIER,
      }),
    );
    fx.remember(order.id);

    expect(order.deliveryMethod).toBe(DELIVERY_METHODS.COURIER);
    expect(order.subtotal).toBe(240_000);
    expect(order.shippingFee).toBe(0);
    expect(order.total).toBe(240_000);
    expect(order.provinceName).toBe('تهران');
    const [stored] = await testDb
      .select({ deliveryMethod: orders.deliveryMethod })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(stored.deliveryMethod).toBe(DELIVERY_METHODS.COURIER);
    expect(await stockOf(product.id)).toBe(3);
  });

  it('a post order in Tehran still pays the province fee', async () => {
    const user = await fx.user();
    const product = await fx.product(await fx.category(), {
      price: 120_000,
      stock: 5,
    });
    const rate = await tehran();

    const order = await createOrder(
      user.id,
      input(rate.provinceId, product.id, {
        deliveryMethod: DELIVERY_METHODS.POST,
      }),
    );
    fx.remember(order.id);

    expect(order.deliveryMethod).toBe(DELIVERY_METHODS.POST);
    expect(order.shippingFee).toBe(rate.fee);
    expect(order.total).toBe(240_000 + rate.fee);
  });

  it('a body with no method is a post order, priced as before courier existed', async () => {
    const user = await fx.user();
    const product = await fx.product(await fx.category(), {
      price: 120_000,
      stock: 5,
    });
    const prov = await elsewhere();

    const order = await createOrder(
      user.id,
      input(prov.provinceId, product.id),
    );
    fx.remember(order.id);

    expect(order.deliveryMethod).toBe(DELIVERY_METHODS.POST);
    expect(order.shippingFee).toBe(60_000);
    expect(order.total).toBe(240_000 + 60_000);
  });

  it('refuses a courier order outside Tehran, reserving nothing', async () => {
    const user = await fx.user();
    const product = await fx.product(await fx.category(), {
      price: 120_000,
      stock: 5,
    });
    const prov = await elsewhere();

    const attempt = createOrder(
      user.id,
      input(prov.provinceId, product.id, {
        deliveryMethod: DELIVERY_METHODS.COURIER,
      }),
    );
    await expect(attempt).rejects.toBeInstanceOf(CheckoutError);
    await expect(attempt).rejects.toMatchObject({
      field: 'deliveryMethod',
      message: COURIER_UNAVAILABLE,
    });

    expect(await stockOf(product.id)).toBe(5);
    const placed = await testDb
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.userId, user.id));
    expect(placed).toHaveLength(0);
  });

  it('refuses a courier order a 100% code brings to zero; the same code by post pays the fee', async () => {
    const user = await fx.user();
    const product = await fx.product(await fx.category(), {
      price: 120_000,
      stock: 5,
    });
    const rate = await tehran();
    const code = await DiscountCodeDao.create({
      code: `TEST-${token().toUpperCase()}`,
      type: DISCOUNT_TYPES.PERCENT,
      value: 100,
      expiresAt: null,
      usageLimit: null,
      minOrderAmount: 0,
      isActive: true,
    });
    codeIds.push(code.id);

    await expect(
      createOrder(
        user.id,
        input(rate.provinceId, product.id, {
          deliveryMethod: DELIVERY_METHODS.COURIER,
          discountCode: code.code,
        }),
      ),
    ).rejects.toMatchObject({ message: ZERO_TOTAL_REFUSED });
    expect(await stockOf(product.id)).toBe(5);

    const order = await createOrder(
      user.id,
      input(rate.provinceId, product.id, {
        deliveryMethod: DELIVERY_METHODS.POST,
        discountCode: code.code,
      }),
    );
    fx.remember(order.id);
    expect(order.total).toBe(rate.fee);
  });
});
