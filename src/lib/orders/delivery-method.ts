// How an order travels to the shopper — the `orders.delivery_method` domain and
// its one rule. Beside `order-status.ts`, and under the same constraint:
//
// **Nothing in this file may import drizzle, `pg` or `@hono/zod-openapi`.** The
// checkout form (a `'use client'` component) offers the methods and asks
// `isCourierProvince` which ones apply; `createOrder` asks the same function
// before it takes the order; the pgEnum in `src/db/schema/orders.ts` is built
// from `DELIVERY_METHOD_VALUES`. One definition, so the page, the API and the
// database can never disagree on what a method is or where courier goes.
//
// **Post** is the province's fee, added to the order. **Courier** («ارسال با
// پیک», sent from the Heravi area of Tehran) adds no fee at all: the shop does
// not price the ride, the shopper pays the courier on delivery, so the order's
// `shipping_fee` snapshot is 0 and its total is the items less any discount.
import { z } from 'zod';
import { normalizeProvinceName } from '@/lib/shipping/province-input';

/**
 * The `orders.delivery_method` column's domain. Never compare against bare
 * strings. As with `ORDER_STATUSES`, never MOVE an existing value: the pgEnum
 * is built from this order.
 */
export const DELIVERY_METHODS = {
  /** Post: the province's shipping fee is added to the order. */
  POST: 'post',
  /** Courier from Heravi, Tehran only: no fee on the order, paid on delivery. */
  COURIER: 'courier',
} as const;

export type DeliveryMethod =
  (typeof DELIVERY_METHODS)[keyof typeof DELIVERY_METHODS];

export const DELIVERY_METHOD_VALUES = Object.values(DELIVERY_METHODS) as [
  DeliveryMethod,
  ...DeliveryMethod[],
];

/** The delivery-method domain as a zod contract, for the checkout body. */
export const deliveryMethodSchema = z.enum(DELIVERY_METHOD_VALUES);

/** How each method reads to a person — storefront and admin panel alike. */
export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
  [DELIVERY_METHODS.POST]: 'پست',
  [DELIVERY_METHODS.COURIER]: 'ارسال با پیک',
};

/** Under the post option on the checkout. */
export const POST_NOTE = 'هزینهٔ ارسال بر اساس استان به سفارش اضافه می‌شود';

/** Under the courier option on the checkout, and beside a courier order. */
export const COURIER_NOTE =
  'ارسال سریع‌تر از محدودهٔ پاسداران؛ هزینهٔ پیک هنگام تحویل با شماست.';

/** In place of an amount on a courier order's shipping row. */
export const COURIER_FEE_TEXT = 'هنگام تحویل، با پیک';

/** Under a disabled courier option: the picked province is not Tehran. */
export const COURIER_TEHRAN_ONLY = 'فقط برای آدرس‌های استان تهران';

/** `createOrder`'s refusal of a courier order outside Tehran. */
export const COURIER_UNAVAILABLE =
  'ارسال با پیک فقط برای آدرس‌های استان تهران ممکن است. ارسال با پست را انتخاب کن.';

/** The one province a courier from Heravi reaches, in its stored form. */
const COURIER_PROVINCE = 'تهران';

/**
 * Whether a courier can take an order to `provinceName`. Compared through the
 * provinces table's own normalizer, so a name typed with an Arabic yeh or kaf,
 * stray spaces or a ZWNJ at either end still reads as Tehran — the same name
 * the table's unique key would have folded it into.
 */
export const isCourierProvince = (provinceName: string): boolean =>
  normalizeProvinceName(provinceName) === COURIER_PROVINCE;

/**
 * The method an order is actually placed with: courier only where a courier
 * goes, post otherwise. The checkout derives its choice through this at render,
 * so a shopper who picked courier and then moved the address out of Tehran
 * sends post rather than a body the server would refuse.
 */
export const effectiveDeliveryMethod = (
  chosen: DeliveryMethod,
  provinceName: string | null,
): DeliveryMethod =>
  chosen === DELIVERY_METHODS.COURIER &&
  provinceName !== null &&
  isCourierProvince(provinceName)
    ? DELIVERY_METHODS.COURIER
    : DELIVERY_METHODS.POST;
