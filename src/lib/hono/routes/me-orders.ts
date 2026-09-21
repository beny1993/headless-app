// GET /api/me/orders — the customer's own order history (newest first), for the
// account orders tab. Auth is enforced by `requireAuth` (mounted on `/me/*` in
// ../index.ts); ownership is enforced by `OrderDao.listByUser`, which filters on
// the session id — the list can only ever contain the caller's orders.
//
// This is a SUMMARY projection: order number, status, method, total, date and a
// line-item count. It carries no payment rows, so no gateway secret
// (`gatewayResponse`/`cardPan`/`authority`/`failureReason`) can reach it. A single
// order's items and safe payment status are read through the owner-scoped detail
// route (`GET /api/orders/{id}`), not here.
//
// The projector is exported so the account server page renders from the exact
// same shape the fetch would return — one type for the resource, never two.
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import type { Env } from 'hono';
import { z } from 'zod';
import { OrderDao, type OrderSummaryRow } from '@/db/dao/OrderDao';
import {
  orderStatusSchema,
  paymentMethodSchema,
} from '@/lib/orders/order-status';
import { apiSuccess, apiSuccessSchema, errorResponse } from '../envelope';
import type { AuthedEnv } from '../middleware/auth';

const OrderSummarySchema = z
  .object({
    orderId: z.uuid(),
    orderNo: z.number().int().positive(),
    status: orderStatusSchema,
    paymentMethod: paymentMethodSchema,
    total: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    itemCount: z.number().int().nonnegative(),
  })
  .openapi('OrderSummary');

/** One order-history row, as the account orders tab renders it. Import, don't restate. */
export type OrderSummaryResponse = z.infer<typeof OrderSummarySchema>;

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

export const meOrdersRoute = createRoute({
  method: 'get',
  path: '/me/orders',
  tags: ['account'],
  summary: 'List your own orders, newest first (auth required, owner only)',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(
            z.array(OrderSummarySchema),
            'MeOrderListResponse',
          ),
        },
      },
      description:
        'The caller’s orders, newest first, with per-order item counts',
    },
    401: errorResponse('No session'),
  },
});

export const meOrdersHandler: RouteHandler<
  typeof meOrdersRoute,
  Env & AuthedEnv
> = async (c) => {
  const user = c.get('user');
  const rows = await OrderDao.listByUser(user.id);
  return c.json(apiSuccess(rows.map(toOrderSummary)), 200);
};
