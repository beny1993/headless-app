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
import { optionalBoundedText, VISIBLE_CHAR } from '@/lib/validation/text';

/**
 * The `orders.status` column's domain. Never compare against bare strings.
 *
 * Order matters: the pgEnum is built from `Object.values` of this object. A
 * new value may go anywhere — drizzle-kit adds it at that position (`ADD VALUE
 * … BEFORE …`) — but never MOVE an existing one: the database's enum order and
 * this list must agree, or the next generate reads a difference and emits the
 * recreate form, which rewrites `orders.status` on a live table.
 */
export const ORDER_STATUSES = {
  /** Zarinpal order awaiting a verified payment. Its stock is already reserved. */
  PENDING_PAYMENT: 'pending_payment',
  /**
   * Card-to-card order waiting for the shopper's transfer receipt. Its stock is
   * already reserved. The first receipt uploaded accepts it into `processing`;
   * an admin can accept it by hand (a receipt sent by DM) or cancel it.
   */
  AWAITING_RECEIPT: 'awaiting_receipt',
  /** Zarinpal payment verified; awaiting the admin to start fulfillment. */
  PAID: 'paid',
  /**
   * Fulfillment started: a verified Zarinpal payment the admin moved on, or an
   * accepted card-to-card order — whose receipt the admin checks from here.
   */
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
    // Never `paid`: a receipt is checked by a person after acceptance, and the
    // card-to-card payment row still flips only at delivery.
    [ORDER_STATUSES.AWAITING_RECEIPT]: [
      ORDER_STATUSES.PROCESSING,
      ORDER_STATUSES.CANCELLED,
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
 * The status a freshly created order starts in. Card-to-card (COD) orders wait
 * at `awaiting_receipt` for the shopper's transfer receipt; Zarinpal orders wait
 * at `pending_payment` for a verified payment. This is the state machine's
 * entry edge — checkout reads it here rather than hardcoding the rule.
 */
export const initialStatusFor = (method: PaymentMethod): OrderStatus =>
  method === PAYMENT_METHODS.COD
    ? ORDER_STATUSES.AWAITING_RECEIPT
    : ORDER_STATUSES.PENDING_PAYMENT;

/**
 * The statuses whose reserved stock waits on nobody in particular — a Zarinpal
 * order until the reconcile sweep expires it, a card-to-card order until its
 * receipt arrives or an admin acts. Both birth states, so checkout's open-order
 * cap counts every order a shopper leaves unfinished, however it is paid.
 */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = [
  ORDER_STATUSES.PENDING_PAYMENT,
  ORDER_STATUSES.AWAITING_RECEIPT,
];

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

/** The longest cancellation reason an admin may write — a sentence, not a letter. */
export const CANCELLATION_REASON_MAX = 200;

/** Every admin cancel must say why; the shopper reads it on their order. */
export const CANCELLATION_REASON_REQUIRED_MESSAGE =
  'برای لغو سفارش، دلیل را بنویس.';

/**
 * Characters that render as nothing: every default-ignorable code point (ZWNJ
 * among them, and the Hangul fillers U+115F, U+1160, U+3164 and U+FFA0, letters
 * by category); the blank Braille pattern U+2800 and the object replacement
 * character U+FFFC, the placeholder pasted rich text leaves (symbols, neither
 * drawing any ink); and the Egyptian hieroglyph full and half blanks U+13441
 * and U+13442 and the musical null notehead U+1D159, which may draw nothing
 * where a font has them (this Mac has none, and Chrome draws a missing-glyph
 * box for each).
 */
const RENDERS_AS_NOTHING =
  /[\p{Default_Ignorable_Code_Point}\u2800\uFFFC\u{13441}\u{13442}\u{1D159}]/gu;

/**
 * The admin transition request body, shared by the route and the panel's
 * control so both validate one schema. `reason` is optional HERE — `{ to:
 * 'processing' }` is a whole request — and required for a cancel by the server
 * (`adminTransitionOrder`'s `reason_required`). A blank field becomes
 * `undefined`, so a cancel submitted empty is refused rather than stored as an
 * empty reason a shopper would read.
 */
export const adminTransitionBodySchema = z.object({
  to: adminTransitionTargetSchema.meta({
    description:
      'The target status. Must be an admin-triggerable next state from the ' +
      "order's current status; `paid`/`failed` are gateway-owned and rejected.",
    example: 'processing',
  }),
  // A reason must show something once what renders as nothing is set aside:
  // zero-width non-joiners pass the shared text rule (ZWNJ belongs inside
  // Persian words), and the Hangul fillers and the blank Braille pattern pass
  // `VISIBLE_CHAR` itself.
  reason: optionalBoundedText(CANCELLATION_REASON_MAX)
    .refine(
      (reason) =>
        reason === undefined ||
        VISIBLE_CHAR.test(reason.replace(RENDERS_AS_NOTHING, '')),
      { error: CANCELLATION_REASON_REQUIRED_MESSAGE },
    )
    .meta({
      description:
        'Why the order is cancelled, shown to the customer. Required when `to` ' +
        'is `cancelled`; ignored otherwise.',
    }),
});

export type AdminTransitionBody = z.infer<typeof adminTransitionBodySchema>;

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
