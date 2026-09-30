// Card-to-card payment receipts: the caps, the copy and the pure rules both
// sides of the upload read — the API route that enforces them, the storefront
// box that shows them, the admin page that lists them.
//
// **Client-safe, like `order-status.ts`**: plain zod and the status vocabulary,
// never drizzle, `pg` or a storage driver, because the receipt box is a
// `'use client'` component.

/** Receipts per order, append-only (a large order split over two transfers). */
export const MAX_RECEIPTS_PER_ORDER = 5;

/**
 * Five megabytes — a receipt-specific ceiling, not the product photos' two: a
 * phone screenshot of a banking app is routinely bigger than a catalogue photo.
 */
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
