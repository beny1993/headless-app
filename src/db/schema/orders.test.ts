// Shape tests for the orders/order_items/payments tables. These need no
// database, so they run on every `pnpm test` — the constraints they name are
// then *enforced* against a live Postgres by the DAO integration suites.
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { orderItems, orders, payments } from '@/db/schema/orders';
import {
  ORDER_STATUS_VALUES,
  PAYMENT_METHOD_VALUES,
  PAYMENT_STATUS_VALUES,
} from '@/lib/orders/order-status';

const checkNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).checks.map((c) => c.name);

const fkTargets = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).foreignKeys.map((fk) => {
    const ref = fk.reference();
    return {
      column: ref.columns[0].name,
      onDelete: fk.onDelete,
    };
  });

describe('orders schema', () => {
  it('stores every timestamp with a timezone', () => {
    // Same guard as the auth and catalog tables: a bare `timestamp()` drops the
    // offset, so an order placed at 20:00 UTC and one at 20:00 +03:30 collapse
    // into the same instant once the account page renders a Jalali date.
    const timestamps = [orders, orderItems, payments]
      .flatMap((table) => Object.values(getTableColumns(table)))
      .filter((column) => column.columnType === 'PgTimestamp');

    expect(timestamps).not.toHaveLength(0);
    for (const column of timestamps) {
      expect(`${column.name}: ${column.getSQLType()}`).toBe(
        `${column.name}: timestamp with time zone`,
      );
    }
  });

  it('keeps every money column in bigint, never a float or a numeric', () => {
    // Toman is an integer currency. `real`/`numeric` would let a rounding error
    // into a total; `integer` overflows at ~2.1 billion Toman.
    const money = [
      orders.subtotal,
      orders.shippingFee,
      orders.discount,
      orders.total,
      orderItems.unitPrice,
      payments.amount,
    ];
    for (const column of money) {
      expect(`${column.name}: ${column.getSQLType()}`).toBe(
        `${column.name}: bigint`,
      );
    }
  });

  it('builds the enums from the shared order-status constants', () => {
    expect(orders.status.enumValues).toEqual(ORDER_STATUS_VALUES);
    expect(orders.paymentMethod.enumValues).toEqual(PAYMENT_METHOD_VALUES);
    expect(payments.method.enumValues).toEqual(PAYMENT_METHOD_VALUES);
    expect(payments.status.enumValues).toEqual(PAYMENT_STATUS_VALUES);
  });

  it('guards money and quantity at the database level', () => {
    expect(checkNames(orders)).toEqual(
      expect.arrayContaining([
        'orders_subtotal_positive',
        'orders_shipping_fee_non_negative',
        'orders_discount_non_negative',
        'orders_total_non_negative',
      ]),
    );
    expect(checkNames(orderItems)).toEqual(
      expect.arrayContaining([
        'order_items_unit_price_positive',
        'order_items_qty_positive',
      ]),
    );
    expect(checkNames(payments)).toEqual(
      expect.arrayContaining(['payments_amount_non_negative']),
    );
  });

  it('gives the order a unique human-readable order_no distinct from its uuid id', () => {
    expect(orders.orderNo.isUnique).toBe(true);
    // The public identifier is the serial, not the uuid; the uuid is the pk.
    expect(orders.id.primary).toBe(true);
    expect(`${orders.orderNo.name}: ${orders.orderNo.getSQLType()}`).toBe(
      'order_no: bigserial',
    );
  });

  it('keeps the applied discount code as a snapshot, never an FK', () => {
    // discount_codes must not appear among the order's foreign keys — the code
    // is copied as text so a later edit to the code never rewrites the order.
    const cols = fkTargets(orders).map((fk) => fk.column);
    expect(cols).not.toContain('discount_code');
    expect(orders.discountCode.notNull).toBe(false);
  });

  it('references its province with restrict but leaves the column nullable', () => {
    // The provinces table (Province Shipping Rates, build order 13) now exists,
    // so province_id is a real FK. It stays nullable on purpose: province_name
    // is the load-bearing snapshot, and forcing NOT NULL would couple every
    // order insert to a matching provinces row. `restrict` protects order
    // history — a province with orders cannot be deleted.
    expect(orders.provinceId.notNull).toBe(false);
    expect(orders.provinceId.getSQLType()).toBe('integer');
    expect(orders.provinceName.notNull).toBe(true);
    expect(fkTargets(orders)).toContainEqual({
      column: 'province_id',
      onDelete: 'restrict',
    });
  });

  it('references the customer with restrict — an order outlives account cleanup', () => {
    expect(fkTargets(orders)).toContainEqual({
      column: 'user_id',
      onDelete: 'restrict',
    });
  });

  it('cascades line items with their order but restricts the product delete', () => {
    expect(fkTargets(orderItems)).toEqual(
      expect.arrayContaining([
        { column: 'order_id', onDelete: 'cascade' },
        { column: 'product_id', onDelete: 'restrict' },
      ]),
    );
  });

  it('snapshots title, sku and unit price onto the line item', () => {
    for (const column of [
      orderItems.title,
      orderItems.sku,
      orderItems.unitPrice,
      orderItems.qty,
    ]) {
      expect(column.notNull).toBe(true);
    }
  });

  it('keys payments by a unique, nullable authority and cascades with the order', () => {
    // Unique so a double verify cannot create a second row; nullable so COD —
    // which has no gateway authority — is representable (Postgres allows many
    // NULLs under a unique index).
    expect(payments.authority.isUnique).toBe(true);
    expect(payments.authority.notNull).toBe(false);
    expect(fkTargets(payments)).toEqual([
      { column: 'order_id', onDelete: 'cascade' },
    ]);
  });

  it('keeps the raw gateway response as jsonb for audit', () => {
    expect(payments.gatewayResponse.getSQLType()).toBe('jsonb');
    expect(payments.gatewayResponse.notNull).toBe(false);
  });

  it('defaults a fresh payment row to pending', () => {
    expect(payments.status.default).toBe(PAYMENT_STATUS_VALUES[0]);
    expect(PAYMENT_STATUS_VALUES[0]).toBe('pending');
  });
});
