// POST /api/checkout — the authenticated endpoint that turns a client cart into
// a real order and reserves its stock. Auth is enforced by `requireAuth`, mounted
// in ../index.ts on a sub-router so the guard runs before the body is parsed.
//
// The handler is deliberately thin: it validates the body against the client-safe
// `checkoutInputSchema`, takes the user id from the SESSION (never the body), and
// hands off to `createOrder` in src/logic/checkout — the multi-DAO transaction
// that re-prices, reserves and snapshots. It maps a `CheckoutError` (expected,
// client-fixable input) to a 422 naming the offending line/field, and lets any
// other throw bubble to the shared 500 handler.
//
// Route pattern, as in ./shipping.ts: a `createRoute` definition plus a separate
// typed `RouteHandler` export. `z` from `zod`, not `@hono/zod-openapi` — see
// ../envelope.ts. The body schema is imported from `@/lib/checkout/checkout-input`
// (the one contract the checkout form will share); response schemas are built here.
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import type { Env } from 'hono';
import { z } from 'zod';
import { checkoutInputSchema } from '@/lib/checkout/checkout-input';
import { orderStatusSchema } from '@/lib/orders/order-status';
import { CheckoutError, createOrder } from '@/logic/checkout/create-order';
import {
  apiError,
  apiErrorSchema,
  apiSuccess,
  apiSuccessSchema,
} from '../envelope';
import type { AuthedEnv } from '../middleware/auth';

const CheckoutResultSchema = z
  .object({
    orderId: z.uuid(),
    /** The human-readable order number, for SMS / support / the result page. */
    orderNo: z.number().int().positive(),
    status: orderStatusSchema,
    // Server-authoritative, integer Toman. `total = subtotal + shippingFee - discount`.
    subtotal: z.number().int().positive(),
    shippingFee: z.number().int().nonnegative(),
    discount: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .openapi('CheckoutResult');

/** The checkout result the FE reads to redirect (COD) or start payment (Zarinpal). */
export type CheckoutResultResponse = z.infer<typeof CheckoutResultSchema>;

const errorResponse = (description: string) =>
  ({
    content: { 'application/json': { schema: apiErrorSchema } },
    description,
  }) as const;

export const checkoutRoute = createRoute({
  method: 'post',
  path: '/checkout',
  tags: ['checkout'],
  summary: 'Create an order from a cart (auth required)',
  request: {
    body: {
      content: { 'application/json': { schema: checkoutInputSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(CheckoutResultSchema, 'CheckoutResponse'),
        },
      },
      description: 'The created order, with server-authoritative totals',
    },
    400: errorResponse('Malformed body — failed schema validation'),
    401: errorResponse('No session'),
    422: errorResponse(
      'A valid body the server refused — unavailable product, insufficient ' +
        'stock, unknown province, too many open (unpaid) orders, or an ' +
        'unsupported discount code; errors[] names the offending line/field',
    ),
  },
});

export const checkoutHandler: RouteHandler<
  typeof checkoutRoute,
  Env & AuthedEnv
> = async (c) => {
  const input = c.req.valid('json');
  const user = c.get('user');

  try {
    const order = await createOrder(user.id, input);
    return c.json(
      apiSuccess({
        orderId: order.id,
        orderNo: order.orderNo,
        status: order.status,
        subtotal: order.subtotal,
        shippingFee: order.shippingFee,
        discount: order.discount,
        total: order.total,
      }),
      200,
    );
  } catch (error) {
    if (error instanceof CheckoutError) {
      // 422, not 400: the body was well-formed, the server refused it. errors[]
      // is `field: persian` so the client can map it back to the input.
      return c.json(
        apiError(error.message, [`${error.field}: ${error.message}`]),
        422,
      );
    }
    throw error;
  }
};
