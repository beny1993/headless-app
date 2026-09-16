// Checkout's one write path: turn a validated client cart into a real order and
// reserve its stock, all inside a single transaction. This is the
// security-critical core of the shop, so it composes the DAOs (the oversell
// guard, the order/payment inserts, the shipping lookup) rather than touching the
// database itself — multi-DAO orchestration is exactly what src/logic/ is for,
// the same rule state-machine.ts obeys.
//
// The server is authoritative over everything money. The client body carries
// product ids and quantities only (`@/lib/checkout/checkout-input` strips the
// rest); here every price is re-read from `products.price`, the shipping fee is
// looked up server-side, and status comes from `initialStatusFor`, never the
// request. See the story's two blocks of carried-in security constraints.
import { db } from '@/db';
import { DiscountCodeDao } from '@/db/dao/DiscountCodeDao';
import { OrderDao, type OrderItemInput } from '@/db/dao/OrderDao';
import { PaymentDao } from '@/db/dao/PaymentDao';
import { ProductDao } from '@/db/dao/ProductDao';
import { ShippingRateDao } from '@/db/dao/ShippingRateDao';
import type { OrderWithItems } from '@/db/schema/orders';
import type { CheckoutInput } from '@/lib/checkout/checkout-input';
import { computeDiscount } from '@/lib/discount/discount-code';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  initialStatusFor,
} from '@/lib/orders/order-status';
import { CheckoutError } from '@/logic/checkout/checkout-error';
import {
  DISCOUNT_EXHAUSTED,
  DISCOUNT_FIELD,
  assertDiscountApplicable,
} from '@/logic/checkout/discount';
import {
  notifiesOnCreate,
  notifyAdminsOfNewOrder,
} from '@/logic/orders/notify-new-order';

// Re-exported so the many importers of `CheckoutError` keep their path
// (`@/logic/checkout/create-order`); the class itself lives in ./checkout-error
// so the discount policy can throw it without an import cycle.
export { CheckoutError };

// Persian, customer-facing. The `errors[]` detail the route builds is
// `${field}: ${message}`, per the design note.
const PRODUCT_UNAVAILABLE = 'محصول انتخابی دیگر در دسترس نیست.';
const INVALID_PROVINCE = 'استان انتخاب‌شده نامعتبر است.';
const TOO_MANY_OPEN_ORDERS =
  'تعداد سفارش‌های در انتظار پرداختِ شما به حد مجاز رسیده است؛ لطفاً یکی را کامل یا لغو کنید.';
const insufficientStock = (title: string) =>
  `موجودی «${title}» برای تعداد درخواستی کافی نیست.`;

/**
 * Interim per-user cap on concurrent `pending_payment` orders (2026-09-02).
 *
 * A Zarinpal checkout reserves stock into a `pending_payment` order, and until
 * the abandoned-order expiry/reconcile job exists that stock has no release path
 * — so one phone-verified account could loop `POST /api/checkout` and permanently
 * zero the catalog (denial of inventory). This cap makes a pre-production / test
 * deploy safe in the meantime. The REAL fix — expiry + restock — arrives with
 * `Story - Zarinpal Payment Integration` (build order 15) and SUPERSEDES this cap
 * (raise or drop it once expiry exists — Benyamin's call at that point).
 *
 * N is generous (a real shopper rarely has >1 unpaid online order at once) yet
 * caps abuse; tune it here.
 */
export const MAX_OPEN_ORDERS = 5;

/** Ascending productId — the deterministic lock order the design mandates. */
const byProductId = (a: { productId: string }, b: { productId: string }) =>
  a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0;

/**
 * The partial unique index that anchors idempotent order creation
 * (`src/db/schema/orders.ts`). A 23505 naming exactly this constraint means a
 * concurrent request with the same `(userId, idempotencyKey)` won the race — not
 * any other uniqueness failure — so `createOrder` returns that order rather than
 * a 500.
 */
const IDEMPOTENCY_CONSTRAINT = 'orders_user_idempotency_key_unique';

/**
 * Whether `error` is a Postgres unique-violation (23505) on `constraint`.
 *
 * node-postgres raises a `DatabaseError` carrying `code`/`constraint`; drizzle
 * may re-wrap it, so the original is checked at `.cause` too. Matching the
 * constraint name (not just the 23505 code) keeps this from mistaking an
 * unrelated unique conflict — a future one added to `orders` — for an
 * idempotency hit.
 */
const isUniqueViolation = (error: unknown, constraint: string): boolean =>
  [error, (error as { cause?: unknown })?.cause].some((candidate) => {
    const pgError = candidate as
      { code?: string; constraint?: string } | null | undefined;
    return pgError?.code === '23505' && pgError?.constraint === constraint;
  });

/**
 * Creates an order for `userId` from a validated checkout body.
 *
 * `userId` comes from the authenticated session at the call site, NEVER from the
 * body — the body schema has no `userId` to smuggle. The steps, in order:
 *
 *  1. Look up the shipping fee by province (fail-fast, before the transaction:
 *     an unknown province reserves nothing).
 *  2. Enforce the interim open-order cap (Zarinpal only — see `MAX_OPEN_ORDERS`).
 *  3. In one transaction, per line **in productId order** (deadlock symmetry with
 *     the restock path): reject a missing or inactive product, then run the atomic
 *     oversell guard; a 0-row decrement is out-of-stock. Snapshot title/sku/price
 *     from the guard's fresh RETURNING row.
 *  4. If a discount code was given, apply it (still in the same transaction, so it
 *     rolls back with everything else): classify it against the server subtotal
 *     for a specific Persian error, then claim one use atomically — 0 rows means
 *     exhausted/expired/deactivated in a race. The amount is computed from the
 *     claimed row and clamped to the subtotal, never client-supplied.
 *  5. Compute integer-Toman totals server-side, insert the order + item snapshots
 *     (with the discount amount + code snapshotted), and (COD only) a `pending`
 *     payment row. Any step failing throws, and the transaction rolls the whole
 *     order — every reservation and the usage claim — back.
 */
export const createOrder = async (
  userId: string,
  input: CheckoutInput,
  idempotencyKey?: string,
): Promise<OrderWithItems> => {
  // 0. Idempotent-replay fast path. A retry (double-submit, a resend of the same
  // checkout) carries the key the first attempt did; if that order already
  // exists, return it before doing ANY work. This is a correctness requirement,
  // not just an optimization: without it a replay of an order that took the last
  // unit would 422 on the stock guard, and a replay of a Zarinpal order that put
  // the user at the open-order cap would 422 on the cap — instead of returning
  // the order the first attempt created. The concurrent race that slips past this
  // (two requests both finding nothing here) is caught at the insert below.
  if (idempotencyKey) {
    const existing = await OrderDao.getByUserAndIdempotencyKey(
      userId,
      idempotencyKey,
    );
    if (existing) return existing;
  }

  // 1. Shipping fee, server-side. `getByProvinceId` has no range guard of its
  // own; the body schema's `provinceIdParamSchema` already bounded the id, so a
  // miss here is a well-formed-but-unknown province → 422.
  const rate = await ShippingRateDao.getByProvinceId(input.address.provinceId);
  if (!rate) throw new CheckoutError('address.provinceId', INVALID_PROVINCE);

  // 2. Interim open-order cap (fail-fast, before the transaction). Only orders
  // that WOULD enter `pending_payment` are gated — the one state whose reserved
  // stock has no release path yet — so a COD checkout (→ `processing`) is never
  // blocked and never counted. See `MAX_OPEN_ORDERS`.
  // ponytail: the count→create window is non-atomic, so a concurrent burst from
  // one user can land a few over N; a sequential loop is hard-capped, which is
  // what the anti-abuse guard needs. A hard invariant is the expiry/reconcile
  // story's job (build order 15), which supersedes this cap.
  if (
    initialStatusFor(input.paymentMethod) === ORDER_STATUSES.PENDING_PAYMENT
  ) {
    const openOrders = await OrderDao.countOpenForUser(userId);
    if (openOrders >= MAX_OPEN_ORDERS) {
      throw new CheckoutError('paymentMethod', TOO_MANY_OPEN_ORDERS);
    }
  }

  // Keep each line's original request index so an error names the line the
  // client sent, even though reservation runs in productId order.
  const lines = input.items
    .map((line, index) => ({ ...line, index }))
    .sort(byProductId);

  try {
    const order = await db.transaction(async (tx) => {
      const loaded = await ProductDao.getByIds(
        tx,
        lines.map((line) => line.productId),
      );
      const byId = new Map(loaded.map((product) => [product.id, product]));

      const items: OrderItemInput[] = [];
      let subtotal = 0;

      for (const line of lines) {
        const field = `items.${line.index}`;
        const product = byId.get(line.productId);
        // Missing or soft-deleted: reject before reserving. `decrementStock`
        // deliberately does not check `isActive`, so this is the gate that keeps
        // a soft-deleted product out of an order.
        if (!product || !product.isActive) {
          throw new CheckoutError(field, PRODUCT_UNAVAILABLE);
        }

        const reserved = await ProductDao.decrementStock(
          tx,
          line.productId,
          line.qty,
        );
        // 0 rows: the atomic `stock >= qty` guard did not match — out of stock.
        if (!reserved) {
          throw new CheckoutError(field, insufficientStock(product.title));
        }
        // A soft-delete that landed between the load and the decrement: the
        // guard ignores `isActive`, so re-check the fresh row and roll back if
        // the product was deactivated mid-flight (closes the TOCTOU window).
        if (!reserved.isActive) {
          throw new CheckoutError(field, PRODUCT_UNAVAILABLE);
        }

        // Snapshot from the guard's RETURNING row, not the pre-load: under READ
        // COMMITTED the UPDATE re-reads the latest committed row when it locks,
        // so this price/title/sku is current even if the cart was built earlier.
        items.push({
          productId: reserved.id,
          title: reserved.title,
          sku: reserved.sku,
          unitPrice: reserved.price,
          qty: line.qty,
        });
        subtotal += reserved.price * line.qty;
      }

      const shippingFee = rate.fee;

      // Discount, if a code was given. Everything money about it is decided here,
      // server-side, against the re-priced subtotal — the client sends only the
      // code string. Classify the loaded row for a specific Persian error, then
      // claim one use atomically (0 rows → exhausted/expired/deactivated in a
      // race). Compute the amount from the CLAIMED row (like the price snapshot
      // above, not the pre-read) and clamp it to the subtotal. The claim is in
      // this transaction, so a later failure (oversell on a following line is
      // impossible here — the lines are done — but the idempotency insert below,
      // or the safe-integer guard) rolls the usage back with the order.
      let discount = 0;
      let discountCode: string | null = null;
      if (input.discountCode !== undefined) {
        const found = await DiscountCodeDao.findByCode(tx, input.discountCode);
        const applicable = assertDiscountApplicable(
          found,
          subtotal,
          new Date(),
        );
        const claimed = await DiscountCodeDao.claim(tx, applicable.id);
        if (!claimed)
          throw new CheckoutError(DISCOUNT_FIELD, DISCOUNT_EXHAUSTED);
        discount = computeDiscount(claimed, subtotal);
        discountCode = claimed.code;
      }

      const total = subtotal + shippingFee - discount;

      // Overflow backstop. The schema bounds qty and the line count, but not
      // qty × price — a corrupt near-2^53 price would otherwise be stored as a
      // rounded bigint. An impossible-data invariant, not client-fixable input,
      // so a plain Error (→ 500) that rolls the transaction back, not a
      // CheckoutError.
      if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(total)) {
        throw new Error(
          `checkout total exceeded the safe-integer range (subtotal=${subtotal}, total=${total})`,
        );
      }

      const order = await OrderDao.create(
        {
          userId,
          status: initialStatusFor(input.paymentMethod),
          paymentMethod: input.paymentMethod,
          subtotal,
          shippingFee,
          discount,
          total,
          discountCode,
          provinceId: rate.provinceId,
          provinceName: rate.name,
          recipientName: input.address.recipientName,
          recipientPhone: input.address.recipientPhone,
          city: input.address.city,
          postalCode: input.address.postalCode,
          addressLine: input.address.addressLine,
          // The idempotency anchor. Written in the SAME transaction as the stock
          // decrement above, so a losing concurrent insert with the same key
          // trips the partial unique index and rolls its reservation back.
          idempotencyKey: idempotencyKey ?? null,
          items,
        },
        tx,
      );

      // COD gets its single `pending` row now; it flips to `paid` only via
      // transitionOrder on delivery. Zarinpal creates its row at payment-request
      // time (story 15), keyed by the gateway authority — none here.
      if (input.paymentMethod === PAYMENT_METHODS.COD) {
        await PaymentDao.create(
          {
            orderId: order.id,
            method: PAYMENT_METHODS.COD,
            status: PAYMENT_STATUSES.PENDING,
            amount: total,
          },
          tx,
        );
      }

      return order;
    });

    // Tell the admins — AFTER the commit, and only here: neither replay branch
    // (the fast path above, the unique-violation catch below) reaches this line,
    // so a double-submit sends one SMS. Deliberately un-awaited and never
    // `await`ed anywhere: `notifyAdminsOfNewOrder` catches everything and never
    // rejects, so the shopper's response cannot be delayed or failed by a wedged
    // SMS provider. Not Next's `after()` — the reconcile sweep and the tests
    // call this function with no request scope at all.
    if (notifiesOnCreate(order.status)) void notifyAdminsOfNewOrder(order.id);

    return order;
  } catch (error) {
    // A concurrent request with the same key won the race: its insert committed
    // first, so this transaction's insert tripped the partial unique index and
    // rolled back (releasing every reservation it made in the same tx). Re-read
    // the winner and return it — the double-submit sees one order, charged once.
    if (idempotencyKey && isUniqueViolation(error, IDEMPOTENCY_CONSTRAINT)) {
      const existing = await OrderDao.getByUserAndIdempotencyKey(
        userId,
        idempotencyKey,
      );
      if (existing) return existing;
    }
    throw error;
  }
};
