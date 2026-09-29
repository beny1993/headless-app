// The province shipping-rate API:
//   · GET /api/shipping/rates            — every ACTIVE province + fee (checkout's
//     province <select>); with `?province=<id>`, just that one (the fee preview).
//     Public and read-only — checkout is behind auth, but the fee preview it
//     shows is not. A deactivated province is absent from both, by the DAO's
//     storefront reads, so the response shape never carries the flag.
//   · PUT /api/shipping/rates/{provinceId} — update one province's fee. Admin
//     only; the guard is mounted in ../index.ts (`requireAdmin`), and the
//     rate-edit UI lands in a later admin story.
//
// Route pattern, as in ./catalog.ts: a `createRoute` definition plus a separate
// typed `RouteHandler` export. Input validation derives from the client-safe
// `@/lib/shipping/shipping-query` (one contract the checkout form shares), so it
// is decorated here with `.meta()` — never `.openapi()`; see the note above
// `ProductListQuerySchema` in ./catalog.ts. `z` from `zod`, not from
// `@hono/zod-openapi` — see ../envelope.ts.
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { z } from 'zod';
import { ShippingRateDao } from '@/db/dao/ShippingRateDao';
import {
  provinceIdParamSchema,
  shippingFeeSchema,
} from '@/lib/shipping/shipping-query';
import { apiError, apiSuccess, apiSuccessSchema } from '../envelope';
import { errorResponse } from '../route-responses';

/**
 * A well-formed province id with no matching province. User-facing, so Persian;
 * answered as a 400 — checkout treats an unknown province as bad input, not a
 * server condition, the same stance the catalog takes on a bad filter value.
 */
export const INVALID_PROVINCE_MESSAGE = 'استان نامعتبر است';

const ShippingRateSchema = z
  .object({
    provinceId: z.number().int().positive(),
    /** Canonical Persian province name — what the <select> renders. */
    name: z.string(),
    /** Integer Toman. Zero is a valid (free) rate. */
    fee: z.number().int().nonnegative(),
  })
  .openapi('ShippingRate');

/** The rate payloads the checkout screens read. Import, don't restate. */
export type ShippingRateResponse = z.infer<typeof ShippingRateSchema>;

/**
 * The admin view of a province: the public rate plus its active flag. Spread
 * from `.shape` rather than `.extend` over the `.openapi()`-tagged object.
 */
export const AdminProvinceSchema = z
  .object({ ...ShippingRateSchema.shape, isActive: z.boolean() })
  .openapi('AdminProvince');

/** The payload the admin province routes and the rate update return. */
export type AdminProvinceResponse = z.infer<typeof AdminProvinceSchema>;

const RatesQuerySchema = z.object({
  province: provinceIdParamSchema.optional().meta({
    description:
      'Filter to one province by its id (the fee preview); omit to list every province.',
    example: 1,
  }),
});

const ProvinceIdParamSchema = z.object({
  provinceId: provinceIdParamSchema.meta({
    param: { name: 'provinceId', in: 'path' },
    example: 1,
  }),
});

/** `{ fee }` — the body of the per-province PUT and of the admin bulk PUT. */
export const RateUpdateBodySchema = z
  .object({
    fee: shippingFeeSchema.meta({
      description: "The province's new shipping fee, integer Toman (0 = free).",
      example: 30_000,
    }),
  })
  .openapi('ShippingRateUpdate');

export const shippingRatesRoute = createRoute({
  method: 'get',
  path: '/shipping/rates',
  tags: ['shipping'],
  summary: 'List province shipping rates, or look up one by ?province=',
  request: { query: RatesQuerySchema },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(
            z.array(ShippingRateSchema),
            'ShippingRateListResponse',
          ),
        },
      },
      description:
        'Every province with its fee, or a single-element list for ?province=',
    },
    400: errorResponse('Invalid or unknown province'),
  },
});

export const shippingRatesHandler: RouteHandler<
  typeof shippingRatesRoute
> = async (c) => {
  const { province } = c.req.valid('query');

  if (province === undefined) {
    return c.json(apiSuccess(await ShippingRateDao.listActive()), 200);
  }

  // Well-formed id, but no such province — the "unknown province is a validation
  // error" acceptance criterion. A single-element list keeps the 200 shape
  // uniform with the full listing; the miss is the 400 instead.
  const rate = await ShippingRateDao.getByProvinceId(province);
  if (!rate) return c.json(apiError(INVALID_PROVINCE_MESSAGE), 400);

  return c.json(apiSuccess([rate]), 200);
};

export const shippingRateUpdateRoute = createRoute({
  method: 'put',
  path: '/shipping/rates/{provinceId}',
  tags: ['shipping'],
  summary: "Update one province's shipping rate (admin only)",
  request: {
    params: ProvinceIdParamSchema,
    body: {
      content: { 'application/json': { schema: RateUpdateBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(AdminProvinceSchema, 'ShippingRateResponse'),
        },
      },
      description: 'The updated province rate',
    },
    400: errorResponse('Invalid body, or an unknown province'),
    401: errorResponse('No session'),
    403: errorResponse('Signed in, but not an admin'),
  },
});

export const shippingRateUpdateHandler: RouteHandler<
  typeof shippingRateUpdateRoute
> = async (c) => {
  const { provinceId } = c.req.valid('param');
  const { fee } = c.req.valid('json');

  const updated = await ShippingRateDao.updateFee(provinceId, fee);
  if (!updated) return c.json(apiError(INVALID_PROVINCE_MESSAGE), 400);

  return c.json(apiSuccess(updated), 200);
};
