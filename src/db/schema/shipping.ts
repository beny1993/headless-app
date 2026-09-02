// Province-based shipping rates. Two tables, per the ER diagram in the vault's
// `Design - Orders and Payments Schema` note:
//   · `provinces`    — the 31 Iranian provinces, keyed by an integer id and a
//                      unique canonical Persian name.
//   · `shipping_rates` — one current fee per province (1:1). There is no rate
//                      history: the admin edits a single fee and checkout reads
//                      it, so a history table would be weight nothing asks for.
//
// Two house rules are load-bearing here, the same the catalog and orders obey:
//   · Money is integer Toman in `bigint` (`mode: 'number'`) — never a float. A
//     shipping fee never approaches 2^53.
//   · Every timestamp is `timestamptz` (`{ withTimezone: true }`).
//
// `orders` snapshots `province_name` and `shipping_fee` at order time, so no
// storefront read ever joins an order back to these tables — they feed the
// checkout fee preview and the admin rate editor, not order display.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

const createdAt = timestamp('created_at', { withTimezone: true })
  .defaultNow()
  .notNull();

const updatedAt = timestamp('updated_at', { withTimezone: true })
  .defaultNow()
  .$onUpdate(() => /* @__PURE__ */ new Date())
  .notNull();

export const provinces = pgTable('provinces', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  /**
   * Canonical Persian display name, stored exactly as written in the seed.
   * Unique because it is the natural key the seed upserts on — a re-run must
   * update «تهران» in place rather than plant a second row.
   */
  name: text('name').notNull().unique(),
  createdAt,
  updatedAt,
});

export const shippingRates = pgTable(
  'shipping_rates',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    /**
     * The province this fee prices. `unique` makes it 1:1 — one current rate per
     * province. `restrict`: a province with a rate cannot be deleted out from
     * under it, and provinces are reference data nothing ever hard-deletes.
     */
    provinceId: integer('province_id')
      .notNull()
      .unique()
      .references(() => provinces.id, { onDelete: 'restrict' }),
    /** Integer Toman. */
    fee: bigint('fee', { mode: 'number' }).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    // fee >= 0, not > 0: free shipping is a real, valid rate; only a negative
    // fee is a bug. Enforced at the last trust boundary — the route validates
    // too, but psql and migrations bypass that.
    check('shipping_rates_fee_non_negative', sql`${table.fee} >= 0`),
  ],
);

export type Province = typeof provinces.$inferSelect;
export type NewProvince = typeof provinces.$inferInsert;
export type ShippingRate = typeof shippingRates.$inferSelect;
export type NewShippingRate = typeof shippingRates.$inferInsert;
