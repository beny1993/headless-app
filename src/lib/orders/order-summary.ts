// The order-history row: one client-safe definition of the summary projection
// that `GET /api/me/orders` returns and the account page renders its first paint
// from. Beside `order-status.ts`, whose enums it is built out of.
//
// **Nothing here may import drizzle, `pg` or `@hono/zod-openapi`** — the account
// tabs are client components. `OrderSummaryRow` is a TYPE import, which is
// erased; keeping the projector here is what stops the account server page
// importing a value out of a Hono route for one pure function.
//
// This is a SUMMARY on purpose: order number, status, method, total, date and a
// line-item count. It carries no payment rows, so no gateway secret
// (`gatewayResponse`/`cardPan`/`authority`/`failureReason`) can reach it. A
// single order's items and safe payment status are read through the
// owner-scoped detail route, never here.
import { z } from 'zod';
import type { OrderSummaryRow } from '@/db/dao/OrderDao';
import { orderStatusSchema, paymentMethodSchema } from './order-status';

/**
 * One order-history row as it crosses the wire.
 * `src/lib/hono/routes/me-orders.ts` registers this shape under `OrderSummary`.
 */
export const orderSummarySchema = z.object({
  orderId: z.uuid(),
  orderNo: z.number().int().positive(),
  status: orderStatusSchema,
  paymentMethod: paymentMethodSchema,
  total: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  itemCount: z.number().int().nonnegative(),
});

/** One order-history row, as the account orders tab renders it. Import, don't restate. */
export type OrderSummaryResponse = z.infer<typeof orderSummarySchema>;

/** OrderSummaryRow → the wire projection: Date to ISO, DB id renamed to orderId. */
export const toOrderSummary = (row: OrderSummaryRow): OrderSummaryResponse => ({
  orderId: row.id,
  orderNo: row.orderNo,
  status: row.status,
  paymentMethod: row.paymentMethod,
  total: row.total,
  createdAt: row.createdAt.toISOString(),
  itemCount: row.itemCount,
});
