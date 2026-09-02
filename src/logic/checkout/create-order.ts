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
import { OrderDao, type OrderItemInput } from '@/db/dao/OrderDao';
import { PaymentDao } from '@/db/dao/PaymentDao';
import { ProductDao } from '@/db/dao/ProductDao';
import { ShippingRateDao } from '@/db/dao/ShippingRateDao';
import type { OrderWithItems } from '@/db/schema/orders';
import type { CheckoutInput } from '@/lib/checkout/checkout-input';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  initialStatusFor,
} from '@/lib/orders/order-status';

/**
 * A checkout that failed on a specific piece of the request — an unavailable
 * product, insufficient stock, an unknown province, a not-yet-supported discount
 * code. `field` names the offending line or field (`items.2`, `address.provinceId`,
 * `discountCode`) so the route can answer 422 with an `errors[]` the client maps
 * back to the input; `message` is the Persian, customer-facing summary the
 * envelope shows. It is deliberately distinct from a thrown `Error` (which the
 * route lets bubble to a 500): a `CheckoutError` is expected, client-fixable input.
 */
export class CheckoutError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}

// Persian, customer-facing. The `errors[]` detail the route builds is
// `${field}: ${message}`, per the design note.
const PRODUCT_UNAVAILABLE = 'محصول انتخابی دیگر در دسترس نیست.';
const INVALID_PROVINCE = 'استان انتخاب‌شده نامعتبر است.';
const DISCOUNT_UNSUPPORTED = 'کد تخفیف فعلاً پشتیبانی نمی‌شود.';
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
 * Creates an order for `userId` from a validated checkout body.
 *
 * `userId` comes from the authenticated session at the call site, NEVER from the
 * body — the body schema has no `userId` to smuggle. The steps, in order:
 *
 *  1. Look up the shipping fee by province (fail-fast, before the transaction:
 *     an unknown province reserves nothing).
 *  2. Enforce the interim open-order cap (Zarinpal only — see `MAX_OPEN_ORDERS`).
 *  3. Reject a discount code — reserved for [[Story - Discount Codes]].
 *  4. In one transaction, per line **in productId order** (deadlock symmetry with
 *     the restock path): reject a missing or inactive product, then run the atomic
 *     oversell guard; a 0-row decrement is out-of-stock. Snapshot title/sku/price
 *     from the guard's fresh RETURNING row.
 *  5. Compute integer-Toman totals server-side, insert the order + item snapshots,
 *     and (COD only) a `pending` payment row. Any line failing throws, and the
 *     transaction rolls the whole order — and every earlier reservation — back.
 */
export const createOrder = async (
  userId: string,
  input: CheckoutInput,
): Promise<OrderWithItems> => {
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

  // 3. Discounts are not wired yet; any code 422s rather than being ignored.
  if (input.discountCode !== undefined) {
    throw new CheckoutError('discountCode', DISCOUNT_UNSUPPORTED);
  }

  // Keep each line's original request index so an error names the line the
  // client sent, even though reservation runs in productId order.
  const lines = input.items
    .map((line, index) => ({ ...line, index }))
    .sort(byProductId);

  return db.transaction(async (tx) => {
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
      // deliberately does not check `isActive`, so this is the gate that keeps a
      // soft-deleted product out of an order.
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
      // A soft-delete that landed between the load and the decrement: the guard
      // ignores `isActive`, so re-check the fresh row and roll back if the
      // product was deactivated mid-flight (closes the TOCTOU window).
      if (!reserved.isActive) {
        throw new CheckoutError(field, PRODUCT_UNAVAILABLE);
      }

      // Snapshot from the guard's RETURNING row, not the pre-load: under READ
      // COMMITTED the UPDATE re-reads the latest committed row when it locks, so
      // this price/title/sku is current even if the cart was built earlier.
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
    const discount = 0; // until Story - Discount Codes
    const total = subtotal + shippingFee - discount;

    // Overflow backstop. The schema bounds qty and the line count, but not
    // qty × price — a corrupt near-2^53 price would otherwise be stored as a
    // rounded bigint. An impossible-data invariant, not client-fixable input, so
    // a plain Error (→ 500) that rolls the transaction back, not a CheckoutError.
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
        discountCode: null,
        provinceId: rate.provinceId,
        provinceName: rate.name,
        recipientName: input.address.recipientName,
        recipientPhone: input.address.recipientPhone,
        city: input.address.city,
        postalCode: input.address.postalCode,
        addressLine: input.address.addressLine,
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
};
