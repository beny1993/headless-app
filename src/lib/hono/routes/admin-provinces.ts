// Admin province management — add a province (with its fee) and deactivate /
// reactivate one. Mounted under `/admin/*` behind `requireAdmin` in ../index.ts;
// the guard runs before every handler here (401 without a session, 403 without
// the admin role), so nothing below re-checks authorization.
//
// Route pattern as in ./admin-discounts.ts: a `createRoute` definition plus a
// separate typed `RouteHandler`. The bodies are the shared, client-safe
// `@/lib/shipping/province-input` schemas — imported, never restated — so the
// editor's create form validates against the rules the API enforces. `z` from
// `zod`, not from `@hono/zod-openapi` (see ../envelope.ts).
//
// No DELETE: three restrict FKs point at a province, so removal is the soft
// delete `PATCH { isActive: false }`. No admin GET either: the rate page reads
// `ShippingRateDao.list` server-side. One province's fee stays on
// `PUT /api/shipping/rates/{provinceId}` (./shipping.ts); the bulk
// `PUT /admin/provinces/fee` — one fee for every province — lives here, because
// a guard on `/shipping/rates` itself would also close the public GET there.
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import type { Env } from 'hono';
import { z } from 'zod';
import { ShippingRateDao } from '@/db/dao/ShippingRateDao';
import {
  provinceCreateSchema,
  provinceToggleSchema,
} from '@/lib/shipping/province-input';
import { provinceIdParamSchema } from '@/lib/shipping/shipping-query';
import {
  apiError,
  apiErrorSchema,
  apiSuccess,
  apiSuccessSchema,
} from '../envelope';
import type { AuthedEnv } from '../middleware/auth';
import { AdminProvinceSchema, RateUpdateBodySchema } from './shipping';

/** User-facing copy, so Persian. */
export const PROVINCE_DUPLICATE_MESSAGE =
  'استانی با این نام قبلاً ثبت شده است.';
/** The name belongs to a deactivated province — say so rather than silently reactivating it. */
export const PROVINCE_INACTIVE_DUPLICATE_MESSAGE =
  'این استان غیرفعال است — فعالش کن';
export const PROVINCE_NOT_FOUND_MESSAGE = 'استان یافت نشد.';

const IdParamSchema = z.object({
  id: provinceIdParamSchema.meta({
    param: { name: 'id', in: 'path' },
    example: 1,
  }),
});

const errorResponse = (description: string) =>
  ({
    content: { 'application/json': { schema: apiErrorSchema } },
    description,
  }) as const;

// ── Create ─────────────────────────────────────────────────────────────────────

export const provinceCreateRoute = createRoute({
  method: 'post',
  path: '/admin/provinces',
  tags: ['admin'],
  summary: 'Add a province with its shipping fee (admin only)',
  request: {
    body: {
      content: { 'application/json': { schema: provinceCreateSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(AdminProvinceSchema, 'ProvinceCreated'),
        },
      },
      description: 'The created province, active, with its fee',
    },
    400: errorResponse('Invalid body'),
    401: errorResponse('No session'),
    403: errorResponse('Signed in, but not an admin'),
    // 409, not the 400 + errors[] categories and discounts answer a duplicate
    // with: the story asks for a conflict here. Do not "align" it.
    409: errorResponse('A province with this (normalized) name already exists'),
  },
});

export const provinceCreateHandler: RouteHandler<
  typeof provinceCreateRoute,
  Env & AuthedEnv
> = async (c) => {
  const body = c.req.valid('json');
  const created = await ShippingRateDao.create(body);
  if (created) return c.json(apiSuccess(created), 201);

  // Taken. The insert already decided the race; this read only picks the
  // message, so there is no check-then-insert window.
  const existing = await ShippingRateDao.findByName(body.name);
  return c.json(
    apiError(
      existing?.isActive === false
        ? PROVINCE_INACTIVE_DUPLICATE_MESSAGE
        : PROVINCE_DUPLICATE_MESSAGE,
    ),
    409,
  );
};

// ── Toggle active (deactivate / reactivate) ──────────────────────────────────────

export const provinceToggleRoute = createRoute({
  method: 'patch',
  path: '/admin/provinces/{id}',
  tags: ['admin'],
  summary: 'Activate or deactivate a province (admin only)',
  request: {
    params: IdParamSchema,
    body: {
      content: { 'application/json': { schema: provinceToggleSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(AdminProvinceSchema, 'ProvinceToggled'),
        },
      },
      description: 'The updated province',
    },
    400: errorResponse('Invalid id or body'),
    401: errorResponse('No session'),
    403: errorResponse('Signed in, but not an admin'),
    404: errorResponse('No such province'),
  },
});

export const provinceToggleHandler: RouteHandler<
  typeof provinceToggleRoute,
  Env & AuthedEnv
> = async (c) => {
  const { id } = c.req.valid('param');
  const { isActive } = c.req.valid('json');
  const updated = await ShippingRateDao.setActive(id, isActive);
  if (!updated) return c.json(apiError(PROVINCE_NOT_FOUND_MESSAGE), 404);
  return c.json(apiSuccess(updated), 200);
};

// ── One fee for every province ───────────────────────────────────────────────────

// PUT, and only PUT: like the per-province rate update, there is deliberately no
// POST/form alias — the CSRF defences (the JSON preflight and SameSite=Lax) both
// depend on it. The static `fee` segment cannot shadow a province: the only
// `{id}` route here is a PATCH.
export const provinceBulkFeeRoute = createRoute({
  method: 'put',
  path: '/admin/provinces/fee',
  tags: ['admin'],
  summary: 'Set one shipping fee for every province (admin only)',
  request: {
    body: {
      content: { 'application/json': { schema: RateUpdateBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(
            z.array(AdminProvinceSchema),
            'ProvinceBulkFeeResponse',
          ),
        },
      },
      description: 'Every province — inactive ones too — with the new fee',
    },
    400: errorResponse('Invalid body'),
    401: errorResponse('No session'),
    403: errorResponse('Signed in, but not an admin'),
  },
});

export const provinceBulkFeeHandler: RouteHandler<
  typeof provinceBulkFeeRoute,
  Env & AuthedEnv
> = async (c) => {
  const { fee } = c.req.valid('json');
  return c.json(apiSuccess(await ShippingRateDao.setAllFees(fee)), 200);
};
