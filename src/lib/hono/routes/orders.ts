// GET /api/orders/{id} — the owner-scoped order read behind the checkout result
// pages and account order history. Auth is enforced by `requireAuth` (mounted in
// ../index.ts); ownership is enforced by `getOwnedOrder`, which returns null for
// an order that does not exist OR belongs to someone else — both answered 404, so
// the read never leaks that another customer's order exists.
//
// The `{id}` param is `z.uuid()`: a non-uuid against a uuid column is a Postgres
// 22P02 the driver would throw as a 500, so it is rejected as a 400 here first.
// The response is a PROJECTION built field by field — `getOwnedOrder` has already
// dropped the payment rows' gateway secrets; this excludes internal columns and
// converts Dates to ISO strings, exactly as ./catalog.ts does for products.
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import type { Env } from 'hono';
import { z } from 'zod';
import {
  paymentMethodSchema,
  paymentStatusSchema,
  orderStatusSchema,
} from '@/lib/orders/order-status';
import { getOwnedOrder, type OwnedOrder } from '@/logic/checkout/get-order';
import { apiError, apiSuccess, apiSuccessSchema } from '../envelope';
import { IdParamSchema, errorResponse } from '../route-responses';
import type { AuthedEnv } from '../middleware/auth';

/** User-facing copy, so Persian. Same answer for missing and not-owned. */
export const ORDER_NOT_FOUND_MESSAGE = 'سفارش یافت نشد';

const OrderItemSchema = z
  .object({
    productId: z.uuid(),
    title: z.string(),
    sku: z.string(),
    unitPrice: z.number().int().positive(),
    qty: z.number().int().positive(),
  })
  .openapi('OrderItem');

const OrderPaymentSchema = z
  .object({
    method: paymentMethodSchema,
    status: paymentStatusSchema,
    paidAt: z.iso.datetime().nullable(),
  })
  .openapi('OrderPayment');

const OrderDetailSchema = z
  .object({
    orderId: z.uuid(),
    orderNo: z.number().int().positive(),
    status: orderStatusSchema,
    paymentMethod: paymentMethodSchema,
    subtotal: z.number().int().positive(),
    shippingFee: z.number().int().nonnegative(),
    discount: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    discountCode: z.string().nullable(),
    provinceId: z.number().int().positive().nullable(),
    provinceName: z.string(),
    recipientName: z.string(),
    recipientPhone: z.string(),
    city: z.string(),
    postalCode: z.string(),
    addressLine: z.string(),
    createdAt: z.iso.datetime(),
    items: z.array(OrderItemSchema),
    payments: z.array(OrderPaymentSchema),
  })
  .openapi('OrderDetail');

/** The order shape the result pages and account history render. Import, don't restate. */
export type OrderDetailResponse = z.infer<typeof OrderDetailSchema>;

/** OwnedOrder → the wire projection: internal columns dropped, Dates to ISO. */
const toOrderDetail = (order: OwnedOrder): OrderDetailResponse => ({
  orderId: order.id,
  orderNo: order.orderNo,
  status: order.status,
  paymentMethod: order.paymentMethod,
  subtotal: order.subtotal,
  shippingFee: order.shippingFee,
  discount: order.discount,
  total: order.total,
  discountCode: order.discountCode,
  provinceId: order.provinceId,
  provinceName: order.provinceName,
  recipientName: order.recipientName,
  recipientPhone: order.recipientPhone,
  city: order.city,
  postalCode: order.postalCode,
  addressLine: order.addressLine,
  createdAt: order.createdAt.toISOString(),
  items: order.items.map((item) => ({
    productId: item.productId,
    title: item.title,
    sku: item.sku,
    unitPrice: item.unitPrice,
    qty: item.qty,
  })),
  payments: order.payments.map((payment) => ({
    method: payment.method,
    status: payment.status,
    paidAt: payment.paidAt ? payment.paidAt.toISOString() : null,
  })),
});

export const orderDetailRoute = createRoute({
  method: 'get',
  path: '/orders/{id}',
  tags: ['orders'],
  summary: 'Read one of your own orders (auth required, owner only)',
  request: { params: IdParamSchema },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(OrderDetailSchema, 'OrderDetailResponse'),
        },
      },
      description: 'The order, with item snapshots and safe payment status',
    },
    400: errorResponse('The id is not a valid uuid'),
    401: errorResponse('No session'),
    404: errorResponse(
      'No such order for this user — deliberately the same answer for an id ' +
        'that never existed and one that belongs to someone else',
    ),
  },
});

export const orderDetailHandler: RouteHandler<
  typeof orderDetailRoute,
  Env & AuthedEnv
> = async (c) => {
  const { id } = c.req.valid('param');
  const user = c.get('user');

  const order = await getOwnedOrder(id, user.id);
  if (!order) return c.json(apiError(ORDER_NOT_FOUND_MESSAGE), 404);

  return c.json(apiSuccess(toOrderDetail(order)), 200);
};
