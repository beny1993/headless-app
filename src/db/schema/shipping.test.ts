// Shape tests for the provinces / shipping_rates tables. No database needed, so
// they run on every `pnpm test`; the constraints they name are then *enforced*
// against a live Postgres by ShippingRateDao.integration.test.ts.
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { provinces, shippingRates } from '@/db/schema/shipping';

const checkNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).checks.map((c) => c.name);

const fkTargets = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).foreignKeys.map((fk) => {
    const ref = fk.reference();
    return {
      column: ref.columns[0].name,
      foreignColumn: ref.foreignColumns[0].name,
      onDelete: fk.onDelete,
    };
  });

describe('provinces schema', () => {
  it('keys a province by an integer id and a unique canonical name', () => {
    // orders.province_id is `integer`, so the referenced pk must be integer too
    // — a uuid or bigint here would make the FK impossible to add.
    expect(provinces.id.primary).toBe(true);
    expect(provinces.id.getSQLType()).toBe('integer');
    expect(provinces.name.notNull).toBe(true);
    // `name` is the natural key the seed upserts on; it must be unique so a
    // re-run updates the row rather than inserting a duplicate تهران.
    expect(provinces.name.isUnique).toBe(true);
  });
});

describe('shipping_rates schema', () => {
  it('stores the fee as integer-Toman bigint, never a float', () => {
    // Same rule as every money column: Toman is an integer currency, and
    // `integer` overflows at ~2.1 billion Toman.
    expect(`${shippingRates.fee.name}: ${shippingRates.fee.getSQLType()}`).toBe(
      'fee: bigint',
    );
  });

  it('stores every timestamp with a timezone', () => {
    const timestamps = Object.values(getTableColumns(shippingRates)).filter(
      (column) => column.columnType === 'PgTimestamp',
    );

    expect(timestamps).not.toHaveLength(0);
    for (const column of timestamps) {
      expect(`${column.name}: ${column.getSQLType()}`).toBe(
        `${column.name}: timestamp with time zone`,
      );
    }
  });

  it('holds exactly one rate per province', () => {
    // 1:1 — the admin edits and checkout reads a single current fee per
    // province, so province_id is unique. (No rate history: YAGNI.)
    expect(shippingRates.provinceId.notNull).toBe(true);
    expect(shippingRates.provinceId.isUnique).toBe(true);
  });

  it('references its province with restrict — reference data is never deleted', () => {
    expect(fkTargets(shippingRates)).toEqual([
      { column: 'province_id', foreignColumn: 'id', onDelete: 'restrict' },
    ]);
  });

  it('forbids a negative fee but allows a free one at the database level', () => {
    // fee >= 0, not > 0: free shipping is a real rate, so zero is valid and only
    // a negative fee is a bug. The route validates too, but psql bypasses that.
    expect(checkNames(shippingRates)).toContain(
      'shipping_rates_fee_non_negative',
    );
  });
});
