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
// snapshots one. What refuses a category still in use is a restricting foreign
// key: the products one (soft-deleted products included) and, since
// sub-categories, the self-referencing parent one. Delete turns either refusal
// into a 409 naming how many products and sub-categories are attached.
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import type { Env } from 'hono';
import { z } from 'zod';
import { CategoryDao, CategoryParentError } from '@/db/dao/CategoryDao';
import type { Category } from '@/db/schema/catalog';
import {
  CATEGORY_PARENT_MESSAGES,
  categoryInputSchema,
} from '@/lib/catalog/category-input';
import { formatNumber } from '@/lib/format';
import { apiError, apiSuccess, apiSuccessSchema } from '../envelope';
import { errorResponse, IdParamSchema } from '../route-responses';
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
export const categoryInUseMessage = (productCount: number, childCount = 0) => {
  if (childCount === 0) {
    return `${formatNumber(productCount)} محصول (شامل محصولات غیرفعال) هنوز در این دسته‌بندی است؛ اول آن‌ها را به دسته‌بندی دیگری منتقل کن.`;
  }
  if (productCount === 0) {
    return `${formatNumber(childCount)} زیردسته هنوز زیر این دسته‌بندی است؛ اول آن‌ها را حذف یا جابه‌جا کن.`;
  }
  return `${formatNumber(childCount)} زیردسته و ${formatNumber(productCount)} محصول (شامل محصولات غیرفعال) هنوز در این دسته‌بندی است؛ اول آن‌ها را جابه‌جا یا حذف کن.`;
};

const CategorySchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    slug: z.string(),
    sortOrder: z.number().int().nonnegative(),
    /** The category this one sits under; `null` for a top-level one. */
    parentId: z.uuid().nullable(),
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
  parentId: c.parentId,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

/**
 * The field error for a refused parent or a taken slug (23505), or `null` to
 * rethrow. Both create and update run a body through it, so the two cannot
 * answer the same refusal differently.
 */
export const categoryWriteErrors = (error: unknown): string[] | null => {
  if (error instanceof CategoryParentError) {
    return [`parentId: ${CATEGORY_PARENT_MESSAGES[error.reason]}`];
  }
  const pg = pgErrorOf(error);
  if (pg?.code === '23505' && pg.constraint === 'categories_slug_unique') {
    return ['slug: این نشانی قبلاً برای دسته‌بندی دیگری ثبت شده است.'];
  }
  // A backstop the DAO's lock makes unreachable — but a 23503 from this key is
  // «that parent is gone» either way, and it must not surface as a 500.
  if (
    pg?.code === '23503' &&
    pg.constraint === 'categories_parent_id_categories_id_fk'
  ) {
    return [`parentId: ${CATEGORY_PARENT_MESSAGES.unknown}`];
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
  summary:
    'Replace a category’s title, slug, sort order and parent (admin only)',
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
      'Products (active or soft-deleted) or sub-categories still reference the category',
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
    // between a count and the delete could not then slip past as a 500. Both
    // counts, never a branch on which key spoke — two of them can refuse, and a
    // category blocked by both must say so in one message.
    const [productCount, childCount] = await Promise.all([
      CategoryDao.countProducts(id),
      CategoryDao.countChildren(id),
    ]);
    return c.json(
      apiError(categoryInUseMessage(productCount, childCount)),
      409,
    );
  }
};
