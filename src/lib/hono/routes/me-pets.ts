// The owner-scoped pet CRUD: GET/POST /api/me/pets and PATCH/DELETE
// /api/me/pets/{id}. Auth is enforced by `requireAuth` (mounted on `/me/*` in
// ../index.ts, so the guard runs before the body is parsed); ownership is enforced
// by `PetDao`, which ANDs the session id into every read and write. The `{id}` in
// the path is the RESOURCE, never the owner — the owner is always `c.get('user')`.
//
// "Not found" and "not yours" are the same 404 (a null from `getOwned`/`update`,
// a false from `delete`), so the API never confirms another user's pet exists.
// The `{id}` param is `z.uuid()`: a non-uuid against a uuid column is a Postgres
// 22P02 the driver throws as a 500, rejected as a 400 here first.
//
// The resource's shape and its projector live in `@/lib/account/pet`, which is
// client-safe: the account server page renders from the exact shape a fetch
// returns without importing this file (and with it `@hono/zod-openapi`) as a
// value. The `PetResponse` type is re-exported below for the consumers that
// already import it from here.
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import type { Env } from 'hono';
import { z } from 'zod';
import { PetDao } from '@/db/dao/PetDao';
import {
  petInputSchema,
  petResponseSchema,
  toPetResponse,
} from '@/lib/account/pet';
import {
  apiError,
  apiSuccess,
  apiSuccessSchema,
  errorResponse,
} from '../envelope';
import type { AuthedEnv } from '../middleware/auth';

/** User-facing copy, so Persian. Same answer for missing and not-owned. */
export const PET_NOT_FOUND_MESSAGE = 'حیوان یافت نشد';

/**
 * A soft per-user ceiling. A real account holds a handful of pets; a request past
 * this is a bug or abuse, not a shopper, so it is refused (422) rather than stored
 * unbounded. Enforced with a count-then-insert — good enough for a vanity list
 * (no concurrency-critical invariant rides on the exact number).
 */
export const MAX_PETS_PER_USER = 20;
const TOO_MANY_PETS_MESSAGE = 'به سقف تعداد حیوانات خانگی رسیده‌ای.';

/**
 * The shape lives in `@/lib/account/pet`: one definition, client-safe,
 * so the server page that renders the first paint projects rows without
 * importing this file. Rebuilt into a local `z.object` before `.openapi()`: that method is
 * grafted on by `@hono/zod-openapi` and zod 4 hands it to newly built schemas
 * only, so calling it on an imported one depends on module evaluation order
 * (the trap documented above `ProductListQuerySchema` in ./catalog.ts).
 */
const PetSchema = z.object(petResponseSchema.shape).openapi('Pet');

/** Re-exported for the client components that already import the type here. */
export type { PetResponse } from '@/lib/account/pet';

const PetIdParamSchema = z.object({
  id: z.uuid().meta({ param: { name: 'id', in: 'path' } }),
});

const jsonBody = {
  content: { 'application/json': { schema: petInputSchema } },
  required: true,
} as const;

const petResponse = (description: string) =>
  ({
    content: {
      'application/json': { schema: apiSuccessSchema(PetSchema, undefined) },
    },
    description,
  }) as const;

// ─── List ──────────────────────────────────────────────────────────────────
export const mePetsListRoute = createRoute({
  method: 'get',
  path: '/me/pets',
  tags: ['account'],
  summary: 'List your own pets (auth required, owner only)',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(z.array(PetSchema), 'MePetListResponse'),
        },
      },
      description: 'The caller’s pets, oldest first',
    },
    401: errorResponse('No session'),
  },
});

export const mePetsListHandler: RouteHandler<
  typeof mePetsListRoute,
  Env & AuthedEnv
> = async (c) => {
  const user = c.get('user');
  const pets = await PetDao.listByUser(user.id);
  return c.json(apiSuccess(pets.map(toPetResponse)), 200);
};

// ─── Create ──────────────────────────────────────────────────────────────────
export const mePetCreateRoute = createRoute({
  method: 'post',
  path: '/me/pets',
  tags: ['account'],
  summary: 'Add a pet to your own profile (auth required)',
  request: { body: jsonBody },
  responses: {
    200: petResponse('The created pet'),
    400: errorResponse('Malformed body (failed schema validation)'),
    401: errorResponse('No session'),
    422: errorResponse('Per-user pet cap reached'),
  },
});

export const mePetCreateHandler: RouteHandler<
  typeof mePetCreateRoute,
  Env & AuthedEnv
> = async (c) => {
  const user = c.get('user');
  const input = c.req.valid('json');

  if ((await PetDao.countForUser(user.id)) >= MAX_PETS_PER_USER) {
    return c.json(apiError(TOO_MANY_PETS_MESSAGE), 422);
  }

  const pet = await PetDao.create(user.id, input);
  return c.json(apiSuccess(toPetResponse(pet)), 200);
};

// ─── Update ──────────────────────────────────────────────────────────────────
export const mePetUpdateRoute = createRoute({
  method: 'patch',
  path: '/me/pets/{id}',
  tags: ['account'],
  summary: 'Update one of your own pets (auth required, owner only)',
  request: { params: PetIdParamSchema, body: jsonBody },
  responses: {
    200: petResponse('The updated pet'),
    400: errorResponse('Invalid id or malformed body'),
    401: errorResponse('No session'),
    404: errorResponse('No such pet for this user (missing or not owned)'),
  },
});

export const mePetUpdateHandler: RouteHandler<
  typeof mePetUpdateRoute,
  Env & AuthedEnv
> = async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const input = c.req.valid('json');

  const pet = await PetDao.update(id, user.id, input);
  if (!pet) return c.json(apiError(PET_NOT_FOUND_MESSAGE), 404);
  return c.json(apiSuccess(toPetResponse(pet)), 200);
};

// ─── Delete ──────────────────────────────────────────────────────────────────
const DeletedSchema = z.object({ id: z.uuid() }).openapi('DeletedPet');

export const mePetDeleteRoute = createRoute({
  method: 'delete',
  path: '/me/pets/{id}',
  tags: ['account'],
  summary: 'Delete one of your own pets (auth required, owner only)',
  request: { params: PetIdParamSchema },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(DeletedSchema, undefined),
        },
      },
      description: 'The id of the deleted pet',
    },
    400: errorResponse('Invalid id'),
    401: errorResponse('No session'),
    404: errorResponse('No such pet for this user (missing or not owned)'),
  },
});

export const mePetDeleteHandler: RouteHandler<
  typeof mePetDeleteRoute,
  Env & AuthedEnv
> = async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const removed = await PetDao.delete(id, user.id);
  if (!removed) return c.json(apiError(PET_NOT_FOUND_MESSAGE), 404);
  return c.json(apiSuccess({ id }), 200);
};
