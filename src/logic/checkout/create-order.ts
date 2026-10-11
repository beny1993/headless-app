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
import { UserDao } from '@/db/dao/UserDao';
import type { OrderWithItems } from '@/db/schema/orders';
import { displayTitle } from '@/lib/catalog/variant';
import type { CheckoutInput } from '@/lib/checkout/checkout-input';
import { computeDiscount } from '@/lib/discount/discount-code';
import {
  COURIER_UNAVAILABLE,
  DELIVERY_METHODS,
  isCourierProvince,
} from '@/lib/orders/delivery-method';
import { isZarinpalEnabled } from '@/lib/zarinpal/client';
import {
  OPEN_ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  byProductId,
  initialStatusFor,
} from '@/lib/orders/order-status';
import { pgErrorOf } from '@/db/pg-error';
import { CheckoutError } from '@/logic/checkout/checkout-error';
import {
  DISCOUNT_EXHAUSTED,
  DISCOUNT_FIELD,
  assertDiscountApplicable,
} from '@/logic/checkout/discount';

// Persian, customer-facing. The `errors[]` detail the route builds is
// `${field}: ${message}`, per the design note.
export const PRODUCT_UNAVAILABLE = 'محصول انتخابی دیگر در دسترس نیست.';
const INVALID_PROVINCE = 'استان انتخاب‌شده نامعتبر است.';
const ONLINE_PAYMENT_UNAVAILABLE =
  'پرداخت آنلاین در حال حاضر در دسترس نیست. پرداخت کارت به کارت را انتخاب کن.';
const TOO_MANY_OPEN_ORDERS =
  'تعداد سفارش‌های در انتظار پرداختِ شما به حد مجاز رسیده است؛ لطفاً یکی را کامل یا لغو کنید.';
const TOO_MANY_RECENT_ORDERS =
  'تعداد سفارش‌های شما در یک ساعت گذشته بیش از حد مجاز است؛ لطفاً بعداً دوباره تلاش کنید.';
const insufficientStock = (title: string) =>
  `موجودی «${title}» برای تعداد درخواستی کافی نیست.`;

/**
 * Per-user cap on concurrent open orders (2026-09-02; card-to-card joined it
 * 2026-09-30).
 *
 * Both birth states reserve stock until a sweep releases it: a Zarinpal
 * checkout's `pending_payment` after an hour (`src/logic/payments/reconcile.ts`)
 * and a card-to-card checkout's `awaiting_receipt` after half an hour
 * (`src/logic/orders/expire-receipt-orders.ts`), both on the five-minute
 * schedule the server runs (`src/logic/orders/order-sweeps.ts`). Within that
 * window one phone-verified account looping `POST /api/checkout` could still
 * zero the catalog (denial of inventory); this cap bounds that, for both
 * methods (`OPEN_ORDER_STATUSES`) — and they are exactly the orders a shopper
 * may cancel themselves. Raising or dropping it is Benyamin's call.
 *
 * N is generous (a real shopper rarely has more than one unfinished order at
 * once) yet caps abuse; tune it here.
 */
export const MAX_OPEN_ORDERS = 5;

/**
 * Rolling per-user cap on order CREATION — every status, every payment method.
 *
 * `MAX_OPEN_ORDERS` above counts only the orders still open, so a shopper who
 * finishes each one — pays it, or uploads a receipt — never meets it. One
 * OTP-verified shopper could therefore loop `POST /api/checkout` with a fresh
 * `Idempotency-Key` each time and mint orders without limit — each accepted one
 * an SMS to every admin (`notifyAdminsOfNewOrder`) and a row burying the real
 * orders on `/admin-panel/orders`. This cap is the one chokepoint that bounds
 * that, for both payment methods at once.
 *
 * 30/hour is far above any real shopper — and above the machines: the E2E
 * suite's single throwaway customer places 19 orders a run (AGENTS.md,
 * «Checkout is rate-capped per account»). Keep that headroom if the suite grows.
 *
 * Deliberately NOT status-aware: cancelling an order must not give the quota
 * back (see `OrderDao.countCreatedSince`). Only time does.
 */
export const MAX_ORDERS_PER_WINDOW = 30;
export const ORDER_RATE_WINDOW_MS = 60 * 60 * 1000;

/**
 * The partial unique index that anchors idempotent order creation
 * (`src/db/schema/orders.ts`). A 23505 naming exactly this constraint means a
 * concurrent request with the same `(userId, idempotencyKey)` won the race — not
 * any other uniqueness failure — so `createOrder` returns that order rather than
 * a 500. A backstop since the account lock: same-key requests from one account
 * now queue, and the re-check under the lock hands the winner back first.
 */
const IDEMPOTENCY_CONSTRAINT = 'orders_user_idempotency_key_unique';

/**
 * Whether `error` is a Postgres unique-violation (23505) on `constraint`.
 * Matching the constraint name (not just the code) keeps this from mistaking an
 * unrelated unique conflict — a future one added to `orders` — for an
 * idempotency hit.
 */
const isUniqueViolation = (error: unknown, constraint: string): boolean => {
  const pg = pgErrorOf(error);
  return pg?.code === '23505' && pg.constraint === constraint;
};

/** The checkout transaction's isolation level, pinned: see step 3a. */
const READ_COMMITTED = { isolationLevel: 'read committed' } as const;

/**
 * Creates an order for `userId` from a validated checkout body.
 *
 * `userId` comes from the authenticated session at the call site, NEVER from the
 * body — the body schema has no `userId` to smuggle. The steps, in order:
 *
 *  1. Look up the shipping fee by province (fail-fast, before the transaction:
 *     an unknown province reserves nothing).
 *  2. Refuse a Zarinpal order while online payment is off, and a courier
 *     order outside the one province a courier reaches.
 *  3. In one transaction, lock this account's user row FIRST, so its checkouts
 *     run one at a time; hand back the order a queued replay of this key already
 *     created; then enforce the rolling creation cap (every method — see
 *     `MAX_ORDERS_PER_WINDOW`) and the open-order cap (every order still waiting
 *     for its payment or receipt — see `MAX_OPEN_ORDERS`), whose counts no
 *     concurrent request can outrun.
 *  4. Per line **in productId order** (deadlock symmetry with the restock path):
 *     reject a missing or inactive product, then run the atomic oversell guard; a
 *     0-row decrement is out-of-stock. Snapshot title/sku/price from the guard's
 *     fresh RETURNING row.
 *  5. If a discount code was given, apply it (still in the same transaction, so it
 *     rolls back with everything else): classify it against the server subtotal
 *     for a specific Persian error, then claim one use atomically — 0 rows means
 *     exhausted/expired/deactivated in a race. The amount is computed from the
 *     claimed row and clamped to the subtotal, never client-supplied.
 *  6. Compute integer-Toman totals server-side, insert the order + item snapshots
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
  // not just an optimization: steps 1–2 run before the account lock, so without
  // it a retry whose province or online payment was switched off after the first
  // attempt committed would 422 there instead of getting its order back.
  // Everything past the lock — the stock guard, the caps — is covered by the
  // re-check under it (3b) as well, which also catches the concurrent race that
  // slips past this (two requests both finding nothing here).
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

  // 2. Online payment switched off. The checkout page hides the option
  // (`APP_CONFIG_ZARINPAL_ENABLED`, read there to build the form), but a page is
  // not a boundary: the API took `paymentMethod` from the body and never asked.
  // A `zarinpal` order on a card-to-card-only shop lands `pending_payment` and
  // holds its stock, and nothing releases it — `POST /payments/zarinpal/request`
  // cannot mint an authority (the gateway guard throws), and the reconcile sweep
  // that would expire and restock it throws before pass 2 as well. So the stock
  // is held until an admin cancels the order by hand, one at a time. Fifty lines
  // per order and five open orders per user is a lot of catalogue for one
  // throwaway account to freeze.
  if (
    input.paymentMethod === PAYMENT_METHODS.ZARINPAL &&
    !isZarinpalEnabled()
  ) {
    throw new CheckoutError('paymentMethod', ONLINE_PAYMENT_UNAVAILABLE);
  }

  // 2b. Courier goes from Heravi, so only within Tehran. The checkout offers it
  // only there, but the body is the boundary: judged against the province the
  // server just looked up, never a name the client sent. Before the
  // transaction, like the province itself, so a refusal reserves nothing.
  if (
    input.deliveryMethod === DELIVERY_METHODS.COURIER &&
    !isCourierProvince(rate.name)
  ) {
    throw new CheckoutError('deliveryMethod', COURIER_UNAVAILABLE);
  }

  // Keep each line's original request index so an error names the line the
  // client sent, even though reservation runs in productId order.
  const lines = input.items
    .map((line, index) => ({ ...line, index }))
    .sort(byProductId);

  try {
    return await db.transaction(async (tx) => {
      // 3a. One checkout per account at a time. This account's user row is the
      // transaction's FIRST lock — product rows are locked only after it, in
      // productId order — so a second checkout of the same account waits here
      // until the first has committed, and the caps below count every order
      // that came before it, however many requests arrived at once. That needs
      // READ COMMITTED, pinned in this transaction's config, as `OtpSendLogDao`
      // pins its own, rather than inherited from `default_transaction_isolation`:
      // a snapshot level takes its snapshot at this lock, before the wait, so
      // the caps and 3b would miss the very orders they waited for.
      // ponytail: a burst from one account queues on its own row, each waiting
      // request holding a pool connection until its turn; the /api/* rate limit
      // bounds that queue. The caps stay per account: N verified phones still
      // make N × MAX_ORDERS_PER_WINDOW an hour — the global SMS cap's job.
      await UserDao.lockForCheckout(tx, userId);

      // 3b. A replay that queued behind its own first attempt. That attempt has
      // committed by now, so hand its order back BEFORE the caps: it may be the
      // very order that filled them, and a double-submit is not a new order.
      if (idempotencyKey) {
        const existing = await OrderDao.getByUserAndIdempotencyKey(
          userId,
          idempotencyKey,
          tx,
        );
        if (existing) return existing;
      }

      // 3c. The rolling creation cap: every order this user created in the
      // window, whatever its status and however it was paid. This is the one
      // that bounds a loop of orders each finished in turn — paid, or given its
      // receipt — which the open-order cap below never sees. See
      // MAX_ORDERS_PER_WINDOW.
      const recentOrders = await OrderDao.countCreatedSince(
        userId,
        new Date(Date.now() - ORDER_RATE_WINDOW_MS),
        tx,
      );
      if (recentOrders >= MAX_ORDERS_PER_WINDOW) {
        throw new CheckoutError('paymentMethod', TOO_MANY_RECENT_ORDERS);
      }

      // 3d. Open-order cap. Gated when the new order would itself be open —
      // today every checkout is, Zarinpal and card to card alike — and counted
      // over every open order this account holds. See `MAX_OPEN_ORDERS`.
      if (OPEN_ORDER_STATUSES.includes(initialStatusFor(input.paymentMethod))) {
        const openOrders = await OrderDao.countOpenForUser(userId, tx);
        if (openOrders >= MAX_OPEN_ORDERS) {
          throw new CheckoutError('paymentMethod', TOO_MANY_OPEN_ORDERS);
        }
      }

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
        // 0 rows: the atomic `stock >= qty` guard did not match — or the row
        // is gone, hard-deleted by the admin after the load above. Read it
        // again in this transaction to tell them apart: a product that is
        // gone or no longer active is unavailable, not out of stock.
        if (!reserved) {
          const [current] = await ProductDao.getByIds(tx, [line.productId]);
          throw new CheckoutError(
            field,
            current?.isActive
              ? insufficientStock(displayTitle(product))
              : PRODUCT_UNAVAILABLE,
          );
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
          // `displayTitle`, not the bare column: a family member's line has to
          // read «غذای خشک سگ — ۱۰ کیلوگرم», or an invoice cannot say which
          // size was bought. The snapshot is the only record of that once the
          // product row is edited, so it is written here and never derived later.
          title: displayTitle(reserved),
          sku: reserved.sku,
          unitPrice: reserved.price,
          qty: line.qty,
        });
        subtotal += reserved.price * line.qty;
      }

      // A courier's ride is the shopper's to pay on delivery: the shop adds no
      // fee, and the snapshot says so, so the total and a card-to-card
      // transfer are the items alone.
      const shippingFee =
        input.deliveryMethod === DELIVERY_METHODS.COURIER ? 0 : rate.fee;

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
          deliveryMethod: input.deliveryMethod ?? DELIVERY_METHODS.POST,
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
          // decrement above, so an insert that ever got past the lock with a
          // taken key trips the partial unique index and rolls its reservation
          // back.
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
    }, READ_COMMITTED);
    // No admin alert here: every checkout is born open, and an unfinished
    // checkout never wakes an admin. A card-to-card order's alert comes when its
    // first receipt accepts it (`uploadReceipt`); a Zarinpal order's when its
    // payment settles (`settlePendingPayment`).
  } catch (error) {
    // A backstop since the account lock, which makes same-key requests queue.
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
