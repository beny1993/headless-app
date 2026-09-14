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
// `toAddressResponse` is exported so the account server page and the checkout
// server page (which offers saved-address prefill) render from one type.
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import type { Env } from 'hono';
import { z } from 'zod';
import { AddressDao, type AddressWithProvince } from '@/db/dao/AddressDao';
import { ShippingRateDao } from '@/db/dao/ShippingRateDao';
import { addressInputSchema } from '@/lib/account/address';
import {
  apiError,
  apiErrorSchema,
  apiSuccess,
  apiSuccessSchema,
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

const AddressSchema = z
  .object({
    id: z.uuid(),
    title: z.string().nullable(),
    recipientName: z.string(),
    recipientPhone: z.string(),
    provinceId: z.number().int().positive(),
    provinceName: z.string(),
    city: z.string(),
    postalCode: z.string(),
    addressLine: z.string(),
    createdAt: z.iso.datetime(),
  })
  .openapi('Address');

/** The saved-address shape the account book and the checkout picker render. */
export type AddressResponse = z.infer<typeof AddressSchema>;

/** AddressWithProvince → the wire projection: Date to ISO, internal columns dropped. */
export const toAddressResponse = (
  row: AddressWithProvince,
): AddressResponse => ({
  id: row.id,
  title: row.title,
  recipientName: row.recipientName,
  recipientPhone: row.recipientPhone,
  provinceId: row.provinceId,
  provinceName: row.provinceName,
  city: row.city,
  postalCode: row.postalCode,
  addressLine: row.addressLine,
  createdAt: row.createdAt.toISOString(),
});

const AddressIdParamSchema = z.object({
  id: z.uuid().meta({ param: { name: 'id', in: 'path' } }),
});

const jsonBody = {
  content: { 'application/json': { schema: addressInputSchema } },
  required: true,
} as const;

const errorResponse = (description: string) =>
  ({
    content: { 'application/json': { schema: apiErrorSchema } },
    description,
  }) as const;

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
