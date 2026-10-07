// The admin's 🗑 contract, shared by `DELETE /api/admin/products/{id}`, the
// logic that decides it (`src/logic/admin/product-removal.ts`) and the button
// that reads its answer. Client-safe: zod and constants only.
//
// A product that nothing references is deleted for real; one that an order line
// or a family member points at is deactivated instead, since both foreign keys
// restrict. The request carries what the admin confirmed, and the server never
// does more: `deactivate` only ever deactivates, and `delete` deletes unless a
// reference appeared since the list was read, in which case it deactivates.
// The server decides under the product's row lock, so the answer says which of
// the two it did.
import { z } from 'zod';

/** What the admin confirmed in the modal. Never compare against bare strings. */
export const DELETE_INTENTS = {
  /** «حذف»: delete for good, or deactivate if something now references it. */
  DELETE: 'delete',
  /** «غیرفعال»: deactivate, and nothing more. */
  DEACTIVATE: 'deactivate',
} as const;

/** The DELETE's query string: the intent the modal showed. Required. */
export const productDeleteQuerySchema = z.object({
  confirm: z.enum([DELETE_INTENTS.DELETE, DELETE_INTENTS.DEACTIVATE]),
});

export type ProductDeleteQuery = z.infer<typeof productDeleteQuerySchema>;
export type DeleteIntent = ProductDeleteQuery['confirm'];

/**
 * The query string a DELETE sends, `?confirm=…`. Built from the schema's own
 * type, so renaming the parameter breaks every caller at compile time.
 */
export const productDeleteSearch = (query: ProductDeleteQuery): string =>
  `?${new URLSearchParams(query)}`;

/** What the DELETE did. Never compare against bare strings. */
export const DELETE_OUTCOMES = {
  /** The row is gone, with its images and extra categories. */
  DELETED: 'deleted',
  /** The row stays, `is_active = false`. */
  DEACTIVATED: 'deactivated',
} as const;

export const productDeleteResultSchema = z.object({
  outcome: z.enum([DELETE_OUTCOMES.DELETED, DELETE_OUTCOMES.DEACTIVATED]),
});

export type ProductDeleteResult = z.infer<typeof productDeleteResultSchema>;
export type DeleteOutcome = ProductDeleteResult['outcome'];

/** Why a product can only be deactivated, never deleted. */
export const HARD_DELETE_BLOCKERS = {
  /** An `order_items` row points at it. */
  ORDERS: 'orders',
  /** A family member (active or not) points at it through `variant_of`. */
  MEMBERS: 'members',
} as const;

export type HardDeleteBlocker =
  (typeof HARD_DELETE_BLOCKERS)[keyof typeof HARD_DELETE_BLOCKERS];
