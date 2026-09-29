// Discount codes — a shopper enters one at checkout, the server validates it and
// claims one use atomically, and the order snapshots the resulting amount. This
// table is never joined back to from order display: `orders.discount` and
// `orders.discount_code` are the load-bearing snapshots (like the price and
// province snapshots the catalog/shipping tables get), so deactivating or editing
// a code never rewrites a placed order.
//
// Three house rules are load-bearing here, the same three the orders schema obeys:
//   · Money is integer Toman in `bigint` (`mode: 'number'`) — never a float. A
//     fixed amount and a min-order threshold never approach 2^53.
//   · Every timestamp is `timestamptz` (`{ withTimezone: true }`).
//   · The CHECKs are the last trust boundary: the checkout/admin routes validate
//     too, but psql and migrations bypass that.
//
// The `discount_type` pgEnum is built from `DISCOUNT_TYPE_VALUES` in
// `@/lib/discount/discount-code`, so the database's domain and the client's (the
// admin form) are one definition — the same wiring the order enums use.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from '@/db/schema/columns';
import { DISCOUNT_TYPE_VALUES } from '@/lib/discount/discount-code';

export const discountTypeEnum = pgEnum('discount_type', DISCOUNT_TYPE_VALUES);

export const discountCodes = pgTable(
  'discount_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * The code the shopper types, stored canonically (trimmed + upper-cased by the
     * DAO). `unique` so a lookup keys on it directly and a duplicate create is
     * refused at the database, not just the route.
     */
    code: text('code').notNull().unique(),
    type: discountTypeEnum('type').notNull(),
    /**
     * The discount magnitude, meaning set by `type`: a `percent` code holds 1–100
     * (a percentage), a `fixed` code holds an integer-Toman amount. `bigint` so a
     * fixed amount is real money; the type-aware CHECK below bounds each kind.
     */
    value: bigint('value', { mode: 'number' }).notNull(),
    /** `null` = never expires. Compared with `now()` in the atomic claim. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** `null` = unlimited uses. The ceiling the atomic claim checks against. */
    usageLimit: integer('usage_limit'),
    /**
     * Uses claimed so far. Moved ONLY by the atomic claim at checkout
     * (`usage_count = usage_count + 1` guarded by the limit) — never by an admin
     * write, which is why it is absent from the admin input contract. Rolls back
     * with the checkout transaction if a later step (stock oversell, idempotency
     * collision) fails.
     */
    usageCount: integer('usage_count').default(0).notNull(),
    /** Minimum subtotal (integer Toman) the code applies to; 0 = no minimum. */
    minOrderAmount: bigint('min_order_amount', { mode: 'number' })
      .default(0)
      .notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    // Type-aware value bound: a percent is 1–100, a fixed amount is > 0. One CHECK
    // so the two ranges can never be mixed up (a 150% code, a 0-Toman code).
    check(
      'discount_codes_value_valid',
      sql`(${table.type} = 'percent' AND ${table.value} >= 1 AND ${table.value} <= 100) OR (${table.type} = 'fixed' AND ${table.value} > 0)`,
    ),
    check(
      'discount_codes_usage_count_non_negative',
      sql`${table.usageCount} >= 0`,
    ),
    // A limit, when set, must allow at least one use — a 0 limit is a create bug,
    // not "disabled" (that is `is_active`). Mirrors the admin schema's `.positive()`.
    check(
      'discount_codes_usage_limit_positive',
      sql`${table.usageLimit} IS NULL OR ${table.usageLimit} > 0`,
    ),
    check(
      'discount_codes_min_order_non_negative',
      sql`${table.minOrderAmount} >= 0`,
    ),
  ],
);

export type DiscountCode = typeof discountCodes.$inferSelect;
export type NewDiscountCode = typeof discountCodes.$inferInsert;
