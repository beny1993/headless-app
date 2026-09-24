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
// The projection's shape and its projector live in `@/lib/orders/order-summary`,
// which is client-safe: the account server page renders from the exact same
// shape the fetch would return without importing this file — and with it
// `@hono/zod-openapi` — as a value.
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import type { Env } from 'hono';
import { z } from 'zod';
import { OrderDao } from '@/db/dao/OrderDao';
import { orderSummarySchema, toOrderSummary } from '@/lib/orders/order-summary';
import { apiSuccess, apiSuccessSchema } from '../envelope';
import { errorResponse, openapiObject } from '../route-responses';
import type { AuthedEnv } from '../middleware/auth';

/** The shape lives in `@/lib/orders/order-summary` — see `openapiObject`. */
const OrderSummarySchema = openapiObject(orderSummarySchema, 'OrderSummary');

/** Re-exported for the client components that already import the type here. */
export type { OrderSummaryResponse } from '@/lib/orders/order-summary';

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
