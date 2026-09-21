// The owner-scoped address CRUD: GET/POST /api/me/addresses and PATCH/DELETE
// /api/me/addresses/{id}. Same shape and same guarantees as ./me-pets.ts — auth by
// `requireAuth` on `/me/*`, ownership by `AddressDao` (session id ANDed into every
// query), one 404 for missing-or-not-yours, a uuid `{id}` param to keep a bad id
// from becoming a 22P02 500.
//
// Reads return the address joined to its province name. The stored address holds a
// live `province_id`; only an ORDER snapshots the province — this is editable data,
// so a later province rename would show here, which is correct.
//
// The resource's shape and its projector live in `@/lib/account/address`, which
// is client-safe: the account server page and the checkout server page (which
// offers saved-address prefill) render from one type without importing this file
// — and with it `@hono/zod-openapi` — as a value.
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import type { Env } from 'hono';
import { z } from 'zod';
import { AddressDao } from '@/db/dao/AddressDao';
import { ShippingRateDao } from '@/db/dao/ShippingRateDao';
import {
  addressInputSchema,
  addressResponseSchema,
  toAddressResponse,
} from '@/lib/account/address';
import {
  apiError,
  apiSuccess,
  apiSuccessSchema,
  errorResponse,
} from '../envelope';
import type { AuthedEnv } from '../middleware/auth';

/** User-facing copy, so Persian. Same answer for missing and not-owned. */
export const ADDRESS_NOT_FOUND_MESSAGE = 'آدرس یافت نشد';

/** A soft per-user ceiling, refused (422) rather than stored unbounded — see me-pets.ts. */
export const MAX_ADDRESSES_PER_USER = 20;
const TOO_MANY_ADDRESSES_MESSAGE = 'به سقف تعداد آدرس‌ها رسیده‌ای.';

/**
 * A province must be active and rated to take a new or edited address
 * (`ShippingRateDao.getByProvinceId`). Anything else is a 422: a well-formed but
 * unknown id (which would otherwise hit the FK as a 500), and a province the
 * admin deactivated — the shop no longer ships there. An update is refused even
 * when `provinceId` is unchanged, so the customer repicks; the storefront forms
 * warn before this backstop is reached.
 */
const INVALID_PROVINCE_MESSAGE = 'استان انتخاب‌شده نامعتبر است.';

/**
 * The shape lives in `@/lib/account/address`: one definition, client-safe,
 * so the server page that renders the first paint projects rows without
 * importing this file. Rebuilt into a local `z.object` before `.openapi()`: that method is
 * grafted on by `@hono/zod-openapi` and zod 4 hands it to newly built schemas
 * only, so calling it on an imported one depends on module evaluation order
 * (the trap documented above `ProductListQuerySchema` in ./catalog.ts).
 */
const AddressSchema = z.object(addressResponseSchema.shape).openapi('Address');

/** Re-exported for the client components that already import the type here. */
export type { AddressResponse } from '@/lib/account/address';

const AddressIdParamSchema = z.object({
  id: z.uuid().meta({ param: { name: 'id', in: 'path' } }),
});

const jsonBody = {
  content: { 'application/json': { schema: addressInputSchema } },
  required: true,
} as const;

const addressResponse = (description: string) =>
  ({
    content: {
      'application/json': {
        schema: apiSuccessSchema(AddressSchema, undefined),
      },
    },
    description,
  }) as const;

// ─── List ──────────────────────────────────────────────────────────────────
export const meAddressesListRoute = createRoute({
  method: 'get',
  path: '/me/addresses',
  tags: ['account'],
  summary: 'List your own saved addresses (auth required, owner only)',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(
            z.array(AddressSchema),
            'MeAddressListResponse',
          ),
        },
      },
      description: 'The caller’s addresses, oldest first, with province names',
    },
    401: errorResponse('No session'),
  },
});

export const meAddressesListHandler: RouteHandler<
  typeof meAddressesListRoute,
  Env & AuthedEnv
> = async (c) => {
  const user = c.get('user');
  const rows = await AddressDao.listByUser(user.id);
  return c.json(apiSuccess(rows.map(toAddressResponse)), 200);
};

// ─── Create ──────────────────────────────────────────────────────────────────
export const meAddressCreateRoute = createRoute({
  method: 'post',
  path: '/me/addresses',
  tags: ['account'],
  summary: 'Save an address to your own book (auth required)',
  request: { body: jsonBody },
  responses: {
    200: addressResponse('The created address'),
    400: errorResponse('Malformed body (failed schema validation)'),
    401: errorResponse('No session'),
    422: errorResponse(
      'Per-user address cap reached, or an unknown or inactive province',
    ),
  },
});

export const meAddressCreateHandler: RouteHandler<
  typeof meAddressCreateRoute,
  Env & AuthedEnv
> = async (c) => {
  const user = c.get('user');
  const input = c.req.valid('json');

  if ((await AddressDao.countForUser(user.id)) >= MAX_ADDRESSES_PER_USER) {
    return c.json(apiError(TOO_MANY_ADDRESSES_MESSAGE), 422);
  }

  if (!(await ShippingRateDao.getByProvinceId(input.provinceId))) {
    return c.json(apiError(INVALID_PROVINCE_MESSAGE), 422);
  }

  const address = await AddressDao.create(user.id, input);
  return c.json(apiSuccess(toAddressResponse(address)), 200);
};

// ─── Update ──────────────────────────────────────────────────────────────────
export const meAddressUpdateRoute = createRoute({
  method: 'patch',
  path: '/me/addresses/{id}',
  tags: ['account'],
  summary: 'Update one of your own addresses (auth required, owner only)',
  request: { params: AddressIdParamSchema, body: jsonBody },
  responses: {
    200: addressResponse('The updated address'),
    400: errorResponse('Invalid id or malformed body'),
    401: errorResponse('No session'),
    404: errorResponse('No such address for this user (missing or not owned)'),
    422: errorResponse('Unknown or inactive province'),
  },
});

export const meAddressUpdateHandler: RouteHandler<
  typeof meAddressUpdateRoute,
  Env & AuthedEnv
> = async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const input = c.req.valid('json');

  if (!(await ShippingRateDao.getByProvinceId(input.provinceId))) {
    return c.json(apiError(INVALID_PROVINCE_MESSAGE), 422);
  }

  const address = await AddressDao.update(id, user.id, input);
  if (!address) return c.json(apiError(ADDRESS_NOT_FOUND_MESSAGE), 404);
  return c.json(apiSuccess(toAddressResponse(address)), 200);
};

// ─── Delete ──────────────────────────────────────────────────────────────────
const DeletedSchema = z.object({ id: z.uuid() }).openapi('DeletedAddress');

export const meAddressDeleteRoute = createRoute({
  method: 'delete',
  path: '/me/addresses/{id}',
  tags: ['account'],
  summary: 'Delete one of your own addresses (auth required, owner only)',
  request: { params: AddressIdParamSchema },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(DeletedSchema, undefined),
        },
      },
      description: 'The id of the deleted address',
    },
    400: errorResponse('Invalid id'),
    401: errorResponse('No session'),
    404: errorResponse('No such address for this user (missing or not owned)'),
  },
});

export const meAddressDeleteHandler: RouteHandler<
  typeof meAddressDeleteRoute,
  Env & AuthedEnv
> = async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const removed = await AddressDao.delete(id, user.id);
  if (!removed) return c.json(apiError(ADDRESS_NOT_FOUND_MESSAGE), 404);
  return c.json(apiSuccess({ id }), 200);
};
