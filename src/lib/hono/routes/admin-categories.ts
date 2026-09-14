// Admin category CRUD — create, update (full body), delete. Mounted under
// `/admin/*` behind `requireAdmin` in ../index.ts; the guard runs before every
// handler here (401 without a session, 403 without the admin role), so nothing
// below re-checks authorization.
//
// Same shape as ./admin-discounts.ts: a `createRoute` definition plus a separate
// typed `RouteHandler`, and the body is the shared, client-safe
// `@/lib/catalog/category-input` — imported, never restated. There is no admin
// GET: the page reads `CategoryDao.list()` server-side, and the storefront's
// public `GET /categories` is untouched.
//
// Unlike products and discount codes, a category is hard-deleted — nothing
// snapshots one. What refuses a category still in use is the products foreign
// key (`ON DELETE RESTRICT`), soft-deleted products included; delete turns that
// refusal into a 409 naming how many products are attached.
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import type { Env } from 'hono';
import { z } from 'zod';
import { CategoryDao } from '@/db/dao/CategoryDao';
import type { Category } from '@/db/schema/catalog';
import { categoryInputSchema } from '@/lib/catalog/category-input';
import { formatNumber } from '@/lib/format';
import {
  apiError,
  apiErrorSchema,
  apiSuccess,
  apiSuccessSchema,
} from '../envelope';
import type { AuthedEnv } from '../middleware/auth';
import { pgErrorOf } from '../pg-error';

/** User-facing copy, so Persian. */
export const CATEGORY_NOT_FOUND_MESSAGE = 'دسته‌بندی یافت نشد.';
/** A save refused by the database (a duplicate slug). */
export const CATEGORY_SAVE_FAILED_MESSAGE =
  'دسته‌بندی ذخیره نشد؛ ورودی را بررسی کن.';

/**
 * The delete refusal. It names the count and says hidden products count too —
 * otherwise a category whose products were all soft-deleted looks empty in the
 * panel, and the refusal looks like a bug.
 */
export const categoryInUseMessage = (productCount: number) =>
  `${formatNumber(productCount)} محصول (شامل محصولات غیرفعال) هنوز در این دسته‌بندی است؛ اول آن‌ها را به دسته‌بندی دیگری منتقل کن.`;

const CategorySchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    slug: z.string(),
    sortOrder: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi('AdminCategory');

/** The category payload — what every route returns and the admin list renders. */
export type CategoryView = z.infer<typeof CategorySchema>;

/** Project a DAO row to the admin response — ISO the dates. */
export const toCategoryView = (c: Category): CategoryView => ({
  id: c.id,
  title: c.title,
  slug: c.slug,
  sortOrder: c.sortOrder,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

const IdParamSchema = z.object({
  id: z.uuid().meta({
    param: { name: 'id', in: 'path' },
    example: '123e4567-e89b-12d3-a456-426614174000',
  }),
});

const errorResponse = (description: string) =>
  ({
    content: { 'application/json': { schema: apiErrorSchema } },
    description,
  }) as const;

/** The field error for a taken slug (23505), or `null` to rethrow. */
export const categoryWriteErrors = (error: unknown): string[] | null => {
  const pg = pgErrorOf(error);
  if (pg?.code === '23505' && pg.constraint === 'categories_slug_unique') {
    return ['slug: این نشانی قبلاً برای دسته‌بندی دیگری ثبت شده است.'];
  }
  return null;
};

// ── Create ─────────────────────────────────────────────────────────────────────

export const categoryCreateRoute = createRoute({
  method: 'post',
  path: '/admin/categories',
  tags: ['admin'],
  summary: 'Create a category (admin only)',
  request: {
    body: {
      content: { 'application/json': { schema: categoryInputSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(CategorySchema, 'CategoryCreated'),
        },
      },
      description: 'The created category',
    },
    400: errorResponse('Invalid body, or a slug already in use'),
    401: errorResponse('No session'),
    403: errorResponse('Signed in, but not an admin'),
  },
});

export const categoryCreateHandler: RouteHandler<
  typeof categoryCreateRoute,
  Env & AuthedEnv
> = async (c) => {
  const body = c.req.valid('json');
  try {
    const created = await CategoryDao.create(body);
    return c.json(apiSuccess(toCategoryView(created)), 201);
  } catch (error) {
    const errors = categoryWriteErrors(error);
    if (errors)
      return c.json(apiError(CATEGORY_SAVE_FAILED_MESSAGE, errors), 400);
    throw error;
  }
};

// ── Update ─────────────────────────────────────────────────────────────────────

export const categoryUpdateRoute = createRoute({
  method: 'put',
  path: '/admin/categories/{id}',
  tags: ['admin'],
  summary: 'Replace a category’s title, slug and sort order (admin only)',
  request: {
    params: IdParamSchema,
    body: {
      content: { 'application/json': { schema: categoryInputSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(CategorySchema, 'CategoryUpdated'),
        },
      },
      description: 'The updated category',
    },
    400: errorResponse('Invalid body, or a slug already in use'),
    401: errorResponse('No session'),
    403: errorResponse('Signed in, but not an admin'),
    404: errorResponse('No such category'),
  },
});

export const categoryUpdateHandler: RouteHandler<
  typeof categoryUpdateRoute,
  Env & AuthedEnv
> = async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  try {
    const updated = await CategoryDao.update(id, body);
    if (!updated) return c.json(apiError(CATEGORY_NOT_FOUND_MESSAGE), 404);
    return c.json(apiSuccess(toCategoryView(updated)), 200);
  } catch (error) {
    const errors = categoryWriteErrors(error);
    if (errors)
      return c.json(apiError(CATEGORY_SAVE_FAILED_MESSAGE, errors), 400);
    throw error;
  }
};

// ── Delete ─────────────────────────────────────────────────────────────────────

export const categoryDeleteRoute = createRoute({
  method: 'delete',
  path: '/admin/categories/{id}',
  tags: ['admin'],
  summary: 'Delete a category no product references (admin only)',
  request: { params: IdParamSchema },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(CategorySchema, 'CategoryDeleted'),
        },
      },
      description: 'The deleted category',
    },
    401: errorResponse('No session'),
    403: errorResponse('Signed in, but not an admin'),
    404: errorResponse('No such category'),
    409: errorResponse(
      'Products (active or soft-deleted) still reference the category',
    ),
  },
});

export const categoryDeleteHandler: RouteHandler<
  typeof categoryDeleteRoute,
  Env & AuthedEnv
> = async (c) => {
  const { id } = c.req.valid('param');
  try {
    const removed = await CategoryDao.deleteById(id);
    if (!removed) return c.json(apiError(CATEGORY_NOT_FOUND_MESSAGE), 404);
    return c.json(apiSuccess(toCategoryView(removed)), 200);
  } catch (error) {
    if (pgErrorOf(error)?.code !== '23503') throw error;
    // Counted after the foreign key refused, not as a pre-check: a product added
    // between a count and the delete could not then slip past as a 500.
    const productCount = await CategoryDao.countProducts(id);
    return c.json(apiError(categoryInUseMessage(productCount)), 409);
  }
};
