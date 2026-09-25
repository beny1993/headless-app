// Admin order routes — read one order in full (the deliberate admin projection),
// and move it through the state machine. Mounted under `/admin/*` behind
// `requireAdmin` in ../index.ts, so the guard runs before every handler here
// (401 without a session, 403 without the admin role) and nothing below re-checks
// authorization.
//
// Route pattern as elsewhere (./orders.ts, ./admin-products.ts): a `createRoute`
// definition plus a separate typed `RouteHandler`. `z` from `zod`, not from
// `@hono/zod-openapi` (see ../envelope.ts).
//
// The admin orders LIST is not here: the list page reads `OrderDao.pageForAdmin`
// directly server-side (the products-page precedent), so there is no list API to
// keep in step. What must be an API is the transition (a client mutation) and the
// by-id read (the projection the security pass probes).
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import type { Env } from 'hono';
import { z } from 'zod';
import {
  adminTransitionTargetSchema,
  orderStatusSchema,
  paymentMethodSchema,
  paymentStatusSchema,
} from '@/lib/orders/order-status';
import { adminTransitionOrder } from '@/logic/orders/admin-transition';
import { getAdminOrder, type AdminOrder } from '@/logic/orders/get-admin-order';
import { apiError, apiSuccess, apiSuccessSchema } from '../envelope';
import { IdParamSchema, errorResponse } from '../route-responses';
import type { AuthedEnv } from '../middleware/auth';

/** User-facing copy, so Persian. */
const ADMIN_ORDER_NOT_FOUND_MESSAGE = 'سفارش یافت نشد';
/** The target is not an admin-triggerable next status from the order's current one. */
const ILLEGAL_TRANSITION_MESSAGE =
  'این تغییر وضعیت مجاز نیست؛ فقط وضعیت‌های بعدیِ مجاز قابل انتخاب‌اند.';
/** The order moved under the operator before the change was applied. */
const TRANSITION_CONFLICT_MESSAGE =
  'وضعیت سفارش هم‌زمان تغییر کرده است؛ صفحه را تازه کن و دوباره تلاش کن.';

const AdminOrderItemSchema = z
  .object({
    productId: z.uuid(),
    title: z.string(),
    sku: z.string(),
    unitPrice: z.number().int().positive(),
    qty: z.number().int().positive(),
  })
  .openapi('AdminOrderItem');

// The admin payment view — wider than the customer's `{method,status,paidAt}`:
// authority, refId, method, amount and the masked card, for reconciliation and
// support. `gatewayResponse` (the raw gateway blob) is NOT here — the projection
// in `getAdminOrder` never carries it.
const AdminPaymentSchema = z
  .object({
    method: paymentMethodSchema,
    status: paymentStatusSchema,
    amount: z.number().int().nonnegative(),
    authority: z.string().nullable(),
    refId: z.string().nullable(),
    cardPan: z.string().nullable(),
    failureReason: z.string().nullable(),
    needsManualRefund: z.boolean(),
    paidAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi('AdminPayment');

const AdminOrderDetailSchema = z
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
    items: z.array(AdminOrderItemSchema),
    payments: z.array(AdminPaymentSchema),
  })
  .openapi('AdminOrderDetail');

/** The admin order shape the detail page and the transition endpoint return. */
type AdminOrderDetailResponse = z.infer<typeof AdminOrderDetailSchema>;

/** AdminOrder → the wire projection: internal columns already dropped, Dates to ISO. */
const toAdminOrderResponse = (order: AdminOrder): AdminOrderDetailResponse => ({
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
    amount: payment.amount,
    authority: payment.authority,
    refId: payment.refId,
    cardPan: payment.cardPan,
    failureReason: payment.failureReason,
    needsManualRefund: payment.needsManualRefund,
    paidAt: payment.paidAt ? payment.paidAt.toISOString() : null,
    createdAt: payment.createdAt.toISOString(),
  })),
});

// ── Detail read ─────────────────────────────────────────────────────────────

export const adminOrderDetailRoute = createRoute({
  method: 'get',
  path: '/admin/orders/{id}',
  tags: ['admin'],
  summary: 'Read one order in full — admin projection (admin only)',
  request: { params: IdParamSchema },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(
            AdminOrderDetailSchema,
            'AdminOrderDetailResponse',
          ),
        },
      },
      description: 'The order with item snapshots and the admin payment view',
    },
    400: errorResponse('The id is not a valid uuid'),
    401: errorResponse('No session'),
    403: errorResponse('Signed in, but not an admin'),
    404: errorResponse('No such order'),
  },
});

export const adminOrderDetailHandler: RouteHandler<
  typeof adminOrderDetailRoute,
  Env & AuthedEnv
> = async (c) => {
  const { id } = c.req.valid('param');
  const order = await getAdminOrder(id);
  if (!order) return c.json(apiError(ADMIN_ORDER_NOT_FOUND_MESSAGE), 404);
  return c.json(apiSuccess(toAdminOrderResponse(order)), 200);
};

// ── Status transition ────────────────────────────────────────────────────────

const TransitionBodySchema = z
  .object({
    to: adminTransitionTargetSchema.meta({
      description:
        'The target status. Must be an admin-triggerable next state from the ' +
        "order's current status; `paid`/`failed` are gateway-owned and rejected.",
      example: 'processing',
    }),
  })
  .openapi('AdminOrderTransition');

export const adminOrderTransitionRoute = createRoute({
  method: 'post',
  path: '/admin/orders/{id}/transitions',
  tags: ['admin'],
  summary: 'Move an order to a legal next status (admin only)',
  request: {
    params: IdParamSchema,
    body: {
      content: { 'application/json': { schema: TransitionBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(
            AdminOrderDetailSchema,
            'AdminOrderTransitioned',
          ),
        },
      },
      description: 'The order after the transition',
    },
    400: errorResponse(
      'Invalid body, or an illegal transition from the current status',
    ),
    401: errorResponse('No session'),
    403: errorResponse('Signed in, but not an admin'),
    404: errorResponse('No such order'),
    409: errorResponse('The order moved before the change could be applied'),
  },
});

export const adminOrderTransitionHandler: RouteHandler<
  typeof adminOrderTransitionRoute,
  Env & AuthedEnv
> = async (c) => {
  const { id } = c.req.valid('param');
  const { to } = c.req.valid('json');

  const result = await adminTransitionOrder(id, to);
  switch (result.outcome) {
    case 'not_found':
      return c.json(apiError(ADMIN_ORDER_NOT_FOUND_MESSAGE), 404);
    case 'illegal':
      return c.json(apiError(ILLEGAL_TRANSITION_MESSAGE), 400);
    case 'conflict':
      return c.json(apiError(TRANSITION_CONFLICT_MESSAGE), 409);
    case 'ok': {
      // Re-read for the response projection. A null here means the order was
      // deleted between the commit and this read — vanishingly unlikely, and 404
      // is the honest answer.
      const order = await getAdminOrder(id);
      if (!order) return c.json(apiError(ADMIN_ORDER_NOT_FOUND_MESSAGE), 404);
      return c.json(apiSuccess(toAdminOrderResponse(order)), 200);
    }
  }
};
