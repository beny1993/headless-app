// The order state machine's vocabulary and its pure rules: the status/method
// domains, the map of which transition is legal, and the two derived questions
// callers ask before touching the database — «may this order go from A to B?»
// (`canTransition`) and «what status does a new order start in?»
// (`initialStatusFor`).
//
// **Nothing in this file may import drizzle, `pg` or `@hono/zod-openapi`** — the
// same rule as `src/lib/catalog/product-query.ts`, and for the same reason. The
// admin panel renders order-status badges and offers only the legal next steps
// as buttons, so a `'use client'` component imports these values; a value import
// of the schema or a DAO here would pull `pg` into the browser bundle and fail
// `next build`. The pgEnums in `src/db/schema/orders.ts` are *built from* these
// constants, so the database's domain and the client's can never drift. The DB
// side effects of a transition (the CAS write, restock, the COD payment flip)
// live in `src/logic/orders/state-machine.ts`, which imports `canTransition`
// from here.
import { z } from 'zod';

/** The `orders.status` column's domain. Never compare against bare strings. */
export const ORDER_STATUSES = {
  /** Zarinpal order awaiting a verified payment. Its stock is already reserved. */
  PENDING_PAYMENT: 'pending_payment',
  /** Zarinpal payment verified; awaiting the admin to start fulfillment. */
  PAID: 'paid',
  /** Fulfillment started. COD orders enter here — no gateway is involved. */
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  /** Terminal. For COD this is where the payment row flips to `paid`. */
  DELIVERED: 'delivered',
  /** Terminal. Cancelled by user or admin; stock is restocked. */
  CANCELLED: 'cancelled',
  /** Terminal. Payment never completed (expiry after reconcile); stock restocked. */
  FAILED: 'failed',
} as const;

export type OrderStatus = (typeof ORDER_STATUSES)[keyof typeof ORDER_STATUSES];

/** The `orders.payment_method` / `payments.method` domain. */
export const PAYMENT_METHODS = {
  ZARINPAL: 'zarinpal',
  COD: 'cod',
} as const;

export type PaymentMethod =
  (typeof PAYMENT_METHODS)[keyof typeof PAYMENT_METHODS];

/** How each method reads to a person — storefront and admin panel alike. */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  [PAYMENT_METHODS.ZARINPAL]: 'زرین‌پال',
  [PAYMENT_METHODS.COD]: 'کارت به کارت',
};

/** The `payments.status` domain — a single payment attempt's lifecycle. */
export const PAYMENT_STATUSES = {
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
} as const;

export type PaymentStatus =
  (typeof PAYMENT_STATUSES)[keyof typeof PAYMENT_STATUSES];

/**
 * The whole set of allowed transitions, as `from → [to, …]`. This is the single
 * source of truth for the diagram in `Design - Orders and Payments Schema`; every
 * legal edge appears here and nothing else does. Terminal statuses map to `[]` so
 * the exhaustiveness of the `Record<OrderStatus, …>` type forces every status —
 * including a newly added one — to declare its outgoing edges (or none).
 *
 * Restock fires on any edge *into* `cancelled` or `failed`; the COD payment flips
 * to `paid` on the edge into `delivered`. Those side effects live with the CAS in
 * `state-machine.ts`; this map only says which edges exist.
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> =
  {
    [ORDER_STATUSES.PENDING_PAYMENT]: [
      ORDER_STATUSES.PAID,
      ORDER_STATUSES.CANCELLED,
      ORDER_STATUSES.FAILED,
    ],
    [ORDER_STATUSES.PAID]: [
      ORDER_STATUSES.PROCESSING,
      ORDER_STATUSES.CANCELLED,
    ],
    [ORDER_STATUSES.PROCESSING]: [
      ORDER_STATUSES.SHIPPED,
      ORDER_STATUSES.CANCELLED,
    ],
    [ORDER_STATUSES.SHIPPED]: [ORDER_STATUSES.DELIVERED],
    [ORDER_STATUSES.DELIVERED]: [],
    [ORDER_STATUSES.CANCELLED]: [],
    [ORDER_STATUSES.FAILED]: [],
  } as const;

/**
 * Whether `from → to` is a legal edge. A self-transition (`from === to`) is never
 * legal — it is never in the map — so a no-op status write is rejected like any
 * other illegal move rather than silently succeeding.
 */
export const canTransition = (from: OrderStatus, to: OrderStatus): boolean =>
  ALLOWED_TRANSITIONS[from].includes(to);

/**
 * The statuses the payment system owns — an order reaches them only through
 * Zarinpal verify (`paid`) or the reconcile/expiry sweep (`failed`), never from
 * an admin pressing a button. They are legal edges of the machine (the CAS still
 * performs them), but they must not be offered as admin transitions: letting an
 * operator flip an order to `paid` would book money the gateway never confirmed.
 */
export const GATEWAY_OWNED_STATUSES: readonly OrderStatus[] = [
  ORDER_STATUSES.PAID,
  ORDER_STATUSES.FAILED,
];

/**
 * The next statuses an admin may *trigger* from `from` — the machine's legal
 * edges (`ALLOWED_TRANSITIONS`) minus the gateway-owned targets. Derived, never
 * a hand-written second list: it is always a subset of the real machine, so the
 * admin UI can never offer an illegal edge and the admin transition endpoint can
 * never be talked into `paid`/`failed`. This is the single source the button list
 * and the server-side transition check both read (the admin panel imports it in a
 * `'use client'` component, which is why it lives in this client-safe module).
 *
 * It reproduces exactly the design's `ADMIN_TRANSITIONS`; the difference is that
 * this cannot drift from `ALLOWED_TRANSITIONS`, whereas a copied map could.
 */
export const adminNextStatuses = (from: OrderStatus): readonly OrderStatus[] =>
  ALLOWED_TRANSITIONS[from].filter(
    (to) => !GATEWAY_OWNED_STATUSES.includes(to),
  );

/**
 * The status a freshly created order starts in. COD orders skip the gateway and
 * enter fulfillment directly at `processing`; Zarinpal orders wait at
 * `pending_payment` for a verified payment. This is the state machine's entry
 * edge — checkout (story 14) reads it here rather than hardcoding the rule.
 */
export const initialStatusFor = (method: PaymentMethod): OrderStatus =>
  method === PAYMENT_METHODS.COD
    ? ORDER_STATUSES.PROCESSING
    : ORDER_STATUSES.PENDING_PAYMENT;

// The domains as non-empty tuples, which is what both `pgEnum` (in
// `src/db/schema/orders.ts`) and `z.enum` below require. The const objects are
// non-empty by construction, so the tuple assertion is sound.
export const ORDER_STATUS_VALUES = Object.values(ORDER_STATUSES) as [
  OrderStatus,
  ...OrderStatus[],
];
export const PAYMENT_METHOD_VALUES = Object.values(PAYMENT_METHODS) as [
  PaymentMethod,
  ...PaymentMethod[],
];
export const PAYMENT_STATUS_VALUES = Object.values(PAYMENT_STATUSES) as [
  PaymentStatus,
  ...PaymentStatus[],
];

// Zod contracts for the domains, derived from the same constants so an API that
// later accepts a status or method (e.g. the admin transition endpoint in story
// 19) validates against exactly the enum the database stores — never a
// hand-mirrored list.
export const orderStatusSchema = z.enum(ORDER_STATUS_VALUES);
export const paymentMethodSchema = z.enum(PAYMENT_METHOD_VALUES);
export const paymentStatusSchema = z.enum(PAYMENT_STATUS_VALUES);

/**
 * The `to` of an admin transition request body. It accepts any order status (a
 * value against the real enum, never a bare string); whether that target is
 * *legal* from the order's current status is decided by `adminNextStatuses`
 * server-side, since legality depends on the current state, not the value alone.
 */
export const adminTransitionTargetSchema = orderStatusSchema;

/**
 * Ascending productId by UTF-16 code unit (plain `<`, never `localeCompare`,
 * whose order varies with the ICU build): the one product-row lock order.
 * Checkout's reservation and the state machine's restock both sort by it, so
 * two transactions touching the same products lock them in the same order and
 * cannot deadlock.
 */
export const byProductId = (
  a: { productId: string },
  b: { productId: string },
) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0);
