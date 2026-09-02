// Orders, their line items, and payments — the commerce core. Shapes follow the
// ER diagram and the state machine in the vault's `Design - Orders and Payments
// Schema` note.
//
// Three house rules are load-bearing here, the same three the catalog obeys:
//   · Money is integer Toman in `bigint` (`mode: 'number'`) — never a float,
//     never a numeric. Toman totals never approach 2^53.
//   · Every timestamp is `timestamptz` (`{ withTimezone: true }`).
//   · Order display is fully snapshotted: items copy title/sku/unit price, the
//     order copies province name, shipping fee and discount. No storefront read
//     ever joins an order back to `products` (which soft-delete and re-price) or
//     to `shipping_rates`.
//
// The status/method/payment-status pgEnums are built from the constants in
// `@/lib/orders/order-status`, so the database's domain and the client's (which
// renders status badges) are one definition — see the note there.
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ORDER_STATUS_VALUES,
  PAYMENT_METHOD_VALUES,
  PAYMENT_STATUS_VALUES,
} from '@/lib/orders/order-status';
import { products } from '@/db/schema/catalog';
import { users } from '@/db/schema/auth';

export const orderStatusEnum = pgEnum('order_status', ORDER_STATUS_VALUES);
export const paymentMethodEnum = pgEnum(
  'payment_method',
  PAYMENT_METHOD_VALUES,
);
export const paymentStatusEnum = pgEnum(
  'payment_status',
  PAYMENT_STATUS_VALUES,
);

const createdAt = timestamp('created_at', { withTimezone: true })
  .defaultNow()
  .notNull();

const updatedAt = timestamp('updated_at', { withTimezone: true })
  .defaultNow()
  .$onUpdate(() => /* @__PURE__ */ new Date())
  .notNull();

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Human-readable order number for SMS, support and admin — a UUID is
     * unusable with a Persian-speaking customer on the phone. `bigserial` so it
     * is dense and monotonic; `unique` so it can key a lookup on its own.
     */
    orderNo: bigserial('order_no', { mode: 'number' }).notNull().unique(),
    /**
     * The customer. `restrict`: an order is a financial record and outlives any
     * account cleanup — a user with orders cannot be deleted out from under
     * them. (The app has no hard-delete-user path anyway.)
     */
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: orderStatusEnum('status').notNull(),
    paymentMethod: paymentMethodEnum('payment_method').notNull(),
    // Money snapshots, integer Toman. `total = subtotal + shipping_fee -
    // discount`, all captured at order time so a later price, rate or code
    // change never rewrites a placed order.
    subtotal: bigint('subtotal', { mode: 'number' }).notNull(),
    shippingFee: bigint('shipping_fee', { mode: 'number' }).notNull(),
    discount: bigint('discount', { mode: 'number' }).default(0).notNull(),
    total: bigint('total', { mode: 'number' }).notNull(),
    /** The applied code, as text — a snapshot, never an FK to `discount_codes`. */
    discountCode: text('discount_code'),
    /**
     * Province reference. Deliberately a plain nullable `integer` with **no FK
     * yet**: the `provinces` table is owned by the *Province Shipping Rates*
     * story (build order 13, which lands after this one), and that story adds
     * the foreign key. `provinceName` below is the load-bearing snapshot; with
     * `shippingFee` it satisfies the "province shipping fee snapshotted on the
     * order" non-negotiable without a join.
     */
    provinceId: integer('province_id'),
    /** Snapshot of the province's display name at order time. */
    provinceName: text('province_name').notNull(),
    recipientName: text('recipient_name').notNull(),
    recipientPhone: text('recipient_phone').notNull(),
    city: text('city').notNull(),
    postalCode: text('postal_code').notNull(),
    addressLine: text('address_line').notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    // Money integrity at the last trust boundary — the checkout API validates
    // too, but psql and migrations bypass that. `subtotal > 0` (an order always
    // has priced items); `shipping_fee >= 0` (free shipping is a real rate);
    // `discount >= 0`; `total >= 0` (a 100% discount code yields a zero total,
    // which must still be a valid order — kept in step with `payments.amount`).
    check('orders_subtotal_positive', sql`${table.subtotal} > 0`),
    check('orders_shipping_fee_non_negative', sql`${table.shippingFee} >= 0`),
    check('orders_discount_non_negative', sql`${table.discount} >= 0`),
    check('orders_total_non_negative', sql`${table.total} >= 0`),
    index('orders_user_id_idx').on(table.userId),
    index('orders_status_idx').on(table.status),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** `cascade`: line items are part of their order and never outlive it. */
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /**
     * The product this line was created from. `restrict` — a product that has
     * ever been ordered cannot be hard-deleted; the storefront soft-deletes it
     * instead, and the snapshot columns below are what order display reads, so
     * the row is kept only for support traceability.
     */
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    /** Snapshot of the product title at order time. */
    title: text('title').notNull(),
    /** Snapshot of the SKU at order time. */
    sku: text('sku').notNull(),
    /** Snapshot of the unit price, integer Toman. Line total is `qty * this`. */
    unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
    qty: integer('qty').notNull(),
    createdAt,
  },
  (table) => [
    check('order_items_unit_price_positive', sql`${table.unitPrice} > 0`),
    check('order_items_qty_positive', sql`${table.qty} > 0`),
    index('order_items_order_id_idx').on(table.orderId),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** `cascade`: a payment attempt belongs to its order. */
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    method: paymentMethodEnum('method').notNull(),
    status: paymentStatusEnum('status')
      .default(PAYMENT_STATUS_VALUES[0])
      .notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    /**
     * The gateway's authority id — Zarinpal's idempotency key for a payment
     * attempt, and what the verify callback (story 15) looks a row up by.
     * `unique` so a double verify can never create a second `paid` row; nullable
     * because COD has no gateway, and Postgres lets a unique column hold many
     * NULLs. An order may have several rows (retried Zarinpal attempts); the
     * order-status CAS is what guarantees at most one ever reaches `paid`.
     */
    authority: text('authority').unique(),
    /** Gateway reference id, set on a successful verify. */
    refId: text('ref_id'),
    /** Masked card number the gateway returns, if any. */
    cardPan: text('card_pan'),
    /** The raw gateway response, kept verbatim for audit and dispute. */
    gatewayResponse: jsonb('gateway_response'),
    failureReason: text('failure_reason'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    // `>= 0`, kept in step with `orders.total`: a fully-discounted order has a
    // zero total, and its COD payment row therefore carries a zero amount.
    check('payments_amount_non_negative', sql`${table.amount} >= 0`),
    index('payments_order_id_idx').on(table.orderId),
  ],
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;

/** An order with its line items, as order display and admin read it. */
export type OrderWithItems = Order & { items: OrderItem[] };
