// Card-to-card payment receipts: the caps, the copy and the pure rules both
// sides of the upload read — the API route that enforces them, the storefront
// box that shows them, the admin page that lists them.
//
// **Client-safe, like `order-status.ts`**: plain zod and the status vocabulary,
// never drizzle, `pg` or a storage driver, because the receipt box is a
// `'use client'` component.
import { z } from 'zod';
import { toPersianDigits } from '@/lib/format';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type OrderStatus,
  type PaymentMethod,
} from '@/lib/orders/order-status';
import {
  formatHint,
  IMAGE_TYPE_ERROR,
  sizeError,
  SNIFF_LENGTH,
  sniffImageType,
} from '@/lib/storage/image-upload';

/** Receipts per order, append-only (a large order split over two transfers). */
export const MAX_RECEIPTS_PER_ORDER = 5;

/**
 * Five megabytes — a receipt-specific ceiling, not the product photos' two: a
 * phone screenshot of a banking app is routinely bigger than a catalogue photo.
 */
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

/** «JPG، PNG یا WEBP، تا ۵ مگابایت» — the hint under the picker. */
export const RECEIPT_FORMAT_HINT = formatHint(MAX_RECEIPT_BYTES);
export const RECEIPT_SIZE_ERROR = sizeError(MAX_RECEIPT_BYTES);
/** A picked file whose bytes the browser could not hand over. */
export const RECEIPT_READ_ERROR = 'این فایل خوانده نشد؛ دوباره انتخاب کن.';

/**
 * A receipt thumbnail's alt text, numbered — «رسید پرداخت ۲» — so five receipts
 * are not five links read out alike. The shopper's box and the admin's list.
 */
export const receiptAlt = (position: number) =>
  `رسید پرداخت ${toPersianDigits(position)}`;

/** Read out after a receipt thumbnail's alt, never shown: its link opens a new tab. */
export const OPENS_IN_NEW_TAB = '(در برگه\u200Cی تازه)';

/** The sixth receipt's refusal — the API's and the box's, one sentence. */
export const RECEIPT_CAP_MESSAGE = `حداکثر ${toPersianDigits(MAX_RECEIPTS_PER_ORDER)} رسید برای هر سفارش؛ برای رسید بیشتر با پشتیبانی تماس بگیر.`;

/**
 * One receipt as the shopper's order carries it and the upload answers with it:
 * its id — which is the last segment of the authenticated URL that serves it —
 * and when it arrived. Never a storage key, a URL or a size: those are the
 * server's business.
 */
export const receiptSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type ReceiptSummary = z.infer<typeof receiptSchema>;

type ReceiptOrder = { paymentMethod: PaymentMethod; status: OrderStatus };

/**
 * Whether an order takes a receipt: card to card, while it waits for one and
 * while it is processed — a second transfer under a daily card limit is
 * normal. Shipped, delivered or cancelled, it takes no more.
 */
export const acceptsReceipts = (order: ReceiptOrder): boolean =>
  order.paymentMethod === PAYMENT_METHODS.COD &&
  (order.status === ORDER_STATUSES.AWAITING_RECEIPT ||
    order.status === ORDER_STATUSES.PROCESSING);

/**
 * Whether an order's page shows the receipt box: while it takes receipts, and
 * afterwards for as long as it has any to list.
 */
export const showsReceipts = (
  order: ReceiptOrder,
  receiptCount: number,
): boolean =>
  order.paymentMethod === PAYMENT_METHODS.COD &&
  (acceptsReceipts(order) || receiptCount > 0);

/** The one pill over an order's receipts: what became of them. */
export const receiptsLabel = (status: OrderStatus): string =>
  status === ORDER_STATUSES.CANCELLED
    ? 'رد شده'
    : status === ORDER_STATUSES.SHIPPED || status === ORDER_STATUSES.DELIVERED
      ? 'تأیید شد'
      : 'دریافت شد؛ در حال بررسی';

/**
 * The browser-side check on a picked file, by the upload route's own rules
 * (`readImageUpload`): the size cap, then the type read from the file's
 * leading bytes with the same `sniffImageType` — never its name or declared
 * type. A Persian message, or `null`. At checkout it is what unlocks
 * «ثبت سفارش»; the server still decides.
 */
export const validateReceiptFile = async (
  file: File,
): Promise<string | null> => {
  if (file.size > MAX_RECEIPT_BYTES) return RECEIPT_SIZE_ERROR;
  const head = await file.slice(0, SNIFF_LENGTH).arrayBuffer();
  return sniffImageType(new Uint8Array(head)) ? null : IMAGE_TYPE_ERROR;
};
