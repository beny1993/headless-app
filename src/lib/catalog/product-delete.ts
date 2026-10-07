// The admin's 🗑 contract, shared by `DELETE /api/admin/products/{id}`, the
// logic that decides it (`src/logic/admin/product-removal.ts`) and the button
// that reads its answer. Client-safe: zod and constants only.
//
// A product that nothing references is deleted for real; one that an order line
// or a family member points at is deactivated instead, since both foreign keys
// restrict. The server decides, under the product's row lock, so the answer
// says which of the two it did.
import { z } from 'zod';

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
