// Admin product CRUD — create, update (full body), soft delete, and image upload.
// Mounted under `/admin/*` behind `requireAdmin` in ../index.ts; the guard runs
// before every handler here (401 without a session, 403 without the admin role),
// so nothing below re-checks authorization.
//
// Route pattern as elsewhere (./shipping.ts, ./catalog.ts): a `createRoute`
// definition plus a separate typed `RouteHandler`. The body contract is the
// shared, client-safe `@/lib/catalog/product-input` — imported, never restated,
// so the form validates against the very rules the API enforces. `z` from `zod`,
// not from `@hono/zod-openapi` (see ../envelope.ts).
//
// The image upload is a plain `POST` handler rather than an `openapi()` route:
// multipart bodies do not fit the JSON-envelope OpenAPI shape, the same reason
// the Zarinpal callback is a plain handler. It still sits behind the same admin
// guard and a `bodyLimit`, and it trusts the file's *bytes*, never its declared
// type or name — see the validation in the handler.
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import type { Context, Env } from 'hono';
import { z } from 'zod';
import { ProductDao, StockConflictError } from '@/db/dao/ProductDao';
import type { Product } from '@/db/schema/catalog';
import {
  productInputSchema,
  productUpdateInputSchema,
} from '@/lib/catalog/product-input';
import { PET_TYPE_VALUES } from '@/lib/catalog/product-query';
import { generateSku } from '@/lib/catalog/sku';
import { replaceProductImage } from '@/logic/admin/product-images';
import { readImageUpload } from '../image-upload';
import {
  apiError,
  apiErrorSchema,
  apiSuccess,
  apiSuccessSchema,
} from '../envelope';
import type { AuthedEnv } from '../middleware/auth';
import { pgErrorOf } from '../pg-error';

/** User-facing copy, so Persian. */
export const PRODUCT_NOT_FOUND_MESSAGE = 'محصول یافت نشد';
/** A save refused by the database (duplicate slug/sku, bad category…). */
export const PRODUCT_SAVE_FAILED_MESSAGE =
  'محصول ذخیره نشد؛ ورودی را بررسی کن.';

/**
 * The admin view of a product — the full row the form round-trips, including
 * `isActive` (which the storefront's `Product` omits) but never the internal
 * `searchText`, which the DAO owns.
 */
const AdminProductSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    slug: z.string(),
    sku: z.string(),
    brand: z.string().nullable(),
    description: z.string().nullable(),
    benefit: z.string().nullable(),
    price: z.number().int().positive(),
    oldPrice: z.number().int().positive().nullable(),
    stock: z.number().int().nonnegative(),
    isActive: z.boolean(),
    categoryId: z.uuid(),
    petTypes: z.array(z.enum(PET_TYPE_VALUES)).min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi('AdminProduct');

/** The admin product payload — what create/update/delete return. */
export type AdminProductResponse = z.infer<typeof AdminProductSchema>;

/** Project a DAO row to the admin response — drops `searchText`, ISO the dates. */
const toAdminProduct = (p: Product): AdminProductResponse => ({
  id: p.id,
  title: p.title,
  slug: p.slug,
  sku: p.sku,
  brand: p.brand,
  description: p.description,
  benefit: p.benefit,
  price: p.price,
  oldPrice: p.oldPrice,
  stock: p.stock,
  isActive: p.isActive,
  categoryId: p.categoryId,
  petTypes: p.petTypes,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
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

// ── Postgres write-error mapping ──────────────────────────────────────────────
// A well-formed body can still be refused by the database: a duplicate slug or
// sku, or a category id that no longer exists. Those are the caller's mistake,
// not a server fault, so they answer 400 with a field-scoped message the form can
// map back onto its input — the "422 an unknown province, not a 500" stance the
// address save established. Anything unrecognized is rethrown as the 500 it is.

/** Field-scoped messages, keyed by the constraint name (from the migration). */
const WRITE_ERROR_MESSAGES: Record<string, string> = {
  products_slug_unique: 'slug: این نشانی قبلاً برای محصول دیگری ثبت شده است.',
  products_sku_unique: 'sku: این کد کالا قبلاً برای محصول دیگری ثبت شده است.',
  products_category_id_categories_id_fk:
    'categoryId: دسته‌بندی انتخاب‌شده معتبر نیست.',
};

/**
 * The `errors[]` detail for a known write conflict, or `null` to rethrow. Covers
 * unique (23505) and FK (23503) violations by constraint name, plus any CHECK
 * (23514) as a generic message — the input schema already blocks the CHECKs, but
 * a psql-side change could still surface one, and a 400 beats a 500. The caller
 * rethrows on `null`, so an unrecognized error stays the 500 it is.
 */
export const productWriteErrors = (error: unknown): string[] | null => {
  const pg = pgErrorOf(error);
  if (!pg) return null;
  if (
    (pg.code === '23505' || pg.code === '23503') &&
    pg.constraint &&
    WRITE_ERROR_MESSAGES[pg.constraint]
  ) {
    return [WRITE_ERROR_MESSAGES[pg.constraint]];
  }
  if (pg.code === '23514') {
    return ['ورودی نامعتبر است — محدودیت پایگاه داده نقض شد.'];
  }
  return null;
};

// ── Create ────────────────────────────────────────────────────────────────────

export const productCreateRoute = createRoute({
  method: 'post',
  path: '/admin/products',
  tags: ['admin'],
  summary: 'Create a product (admin only)',
  request: {
    body: {
      content: { 'application/json': { schema: productInputSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(AdminProductSchema, 'AdminProductCreated'),
        },
      },
      description: 'The created product',
    },
    400: errorResponse('Invalid body, or a duplicate slug/sku'),
    401: errorResponse('No session'),
    403: errorResponse('Signed in, but not an admin'),
  },
});

export const productCreateHandler: RouteHandler<
  typeof productCreateRoute,
  Env & AuthedEnv
> = async (c) => {
  const body = c.req.valid('json');
  try {
    // The SKU is server-owned: derived from the slug once, here. The body schema
    // has no `sku`, and the update route never passes one, so it never changes.
    const created = await ProductDao.create({
      ...body,
      sku: generateSku(body.slug),
    });
    return c.json(apiSuccess(toAdminProduct(created)), 201);
  } catch (error) {
    const errors = productWriteErrors(error);
    if (errors)
      return c.json(apiError(PRODUCT_SAVE_FAILED_MESSAGE, errors), 400);
    throw error;
  }
};

// ── Update (full body) ─────────────────────────────────────────────────────────

export const productUpdateRoute = createRoute({
  method: 'put',
  path: '/admin/products/{id}',
  tags: ['admin'],
  summary: 'Replace a product (admin only)',
  request: {
    params: IdParamSchema,
    body: {
      content: { 'application/json': { schema: productUpdateInputSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(AdminProductSchema, 'AdminProductUpdated'),
        },
      },
      description: 'The updated product',
    },
    400: errorResponse('Invalid body, or a duplicate slug/sku'),
    401: errorResponse('No session'),
    403: errorResponse('Signed in, but not an admin'),
    404: errorResponse('No such product'),
    409: errorResponse('Stock changed since the form was opened'),
  },
});

export const productUpdateHandler: RouteHandler<
  typeof productUpdateRoute,
  Env & AuthedEnv
> = async (c) => {
  const { id } = c.req.valid('param');
  const { expectedStock, ...body } = c.req.valid('json');
  try {
    const updated = await ProductDao.update(id, body, expectedStock);
    if (!updated) return c.json(apiError(PRODUCT_NOT_FOUND_MESSAGE), 404);
    return c.json(apiSuccess(toAdminProduct(updated)), 200);
  } catch (error) {
    if (error instanceof StockConflictError)
      return c.json(apiError(error.message, [`stock: ${error.message}`]), 409);
    const errors = productWriteErrors(error);
    if (errors)
      return c.json(apiError(PRODUCT_SAVE_FAILED_MESSAGE, errors), 400);
    throw error;
  }
};

// ── Soft delete ────────────────────────────────────────────────────────────────

export const productDeleteRoute = createRoute({
  method: 'delete',
  path: '/admin/products/{id}',
  tags: ['admin'],
  summary: 'Soft-delete a product — sets is_active=false (admin only)',
  request: { params: IdParamSchema },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(AdminProductSchema, 'AdminProductDeleted'),
        },
      },
      description: 'The deactivated product (the row is kept, never removed)',
    },
    401: errorResponse('No session'),
    403: errorResponse('Signed in, but not an admin'),
    404: errorResponse('No such product'),
  },
});

export const productDeleteHandler: RouteHandler<
  typeof productDeleteRoute,
  Env & AuthedEnv
> = async (c) => {
  const { id } = c.req.valid('param');
  // Soft delete only — the row stays so past order snapshots keep resolving.
  const removed = await ProductDao.softDelete(id);
  if (!removed) return c.json(apiError(PRODUCT_NOT_FOUND_MESSAGE), 404);
  return c.json(apiSuccess(toAdminProduct(removed)), 200);
};

// ── Image upload (multipart) ────────────────────────────────────────────────────

/**
 * Store one uploaded image for a product. Plain handler (see the file header);
 * `bodyLimit` on this path refuses an oversize body before it is buffered, and
 * this re-checks the read length as a backstop. Type is decided by sniffing the
 * bytes, never by the client's declared content-type or filename, and the stored
 * key is generated server-side — so nothing the client controls reaches the path.
 */
export const productImageUploadHandler = async (
  c: Context<Env & AuthedEnv>,
): Promise<Response> => {
  // Malformed id → the same 400 the openapi routes give for a bad uuid, before a
  // text value can reach the uuid column and raise a 22P02 500.
  const id = z.uuid().safeParse(c.req.param('id'));
  if (!id.success) {
    return c.json(apiError(PRODUCT_NOT_FOUND_MESSAGE), 400);
  }

  const product = await ProductDao.findByIdForAdmin(id.data);
  if (!product) return c.json(apiError(PRODUCT_NOT_FOUND_MESSAGE), 404);

  // The shared trust boundary: parse the body, refuse a missing/empty/oversize
  // file, and sniff the real type from the bytes. Identical to the content
  // upload — the only difference is what happens with the bytes afterwards.
  const upload = await readImageUpload(c);
  if (!upload.ok) return upload.response;

  const stored = await replaceProductImage(product, upload.bytes, upload.type);
  return c.json(apiSuccess(stored), 201);
};
