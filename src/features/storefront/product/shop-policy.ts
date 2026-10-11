// The shop's delivery and return terms (Benyamin, 2026-10-02). The product
// page states them and its structured data repeats them, both from here, so
// what Google shows a shopper is what the page tells them.
import { formatNumber } from '@/lib/format';

/** Days from the order to the parcel leaving the shop. */
export const HANDLING_DAYS = { min: 1, max: 2 } as const;
/** Days from the parcel leaving to it reaching the shopper. */
export const TRANSIT_DAYS = { min: 2, max: 5 } as const;
/** Days from delivery a shopper may send a product back, at their own cost. */
export const RETURN_DAYS = 7;

const days = ({ min, max }: { min: number; max: number }) =>
  `${formatNumber(min)} تا ${formatNumber(max)} روز`;

export const DELIVERY_NOTE = `آماده‌سازی ${days(HANDLING_DAYS)}، ارسال ${days(TRANSIT_DAYS)}`;
export const RETURN_NOTE = `امکان مرجوعی تا ${formatNumber(RETURN_DAYS)} روز پس از تحویل؛ هزینه‌ی ارسال مرجوعی با خریدار`;
