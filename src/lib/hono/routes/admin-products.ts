// Admin product CRUD — create, update (full body), delete (or deactivate, when
// something references the product), and the two gallery writes (append one
// photo, store the whole order).
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
import {
  ProductDao,
  ProductVariantError,
  type VariantRuleReason,
  StockConflictError,
  type ProductWithExtraCategories,
} from '@/db/dao/ProductDao';
import {
  MAX_PRODUCT_IMAGES,
  PRODUCT_MESSAGES,
  productImagesOrderSchema,
  productInputSchema,
  productUpdateInputSchema,
} from '@/lib/catalog/product-input';
import { generateSku } from '@/lib/catalog/sku';
import { productDeleteResultSchema } from '@/lib/catalog/product-delete';
import {
  appendProductImage,
  setProductImageOrder,
} from '@/logic/admin/product-images';
import { removeProduct } from '@/logic/admin/product-removal';
import { readImageUpload } from '../image-upload';
import { apiError, apiSuccess, apiSuccessSchema } from '../envelope';
import { errorResponse, IdParamSchema } from '../route-responses';
import type { AuthedEnv } from '../middleware/auth';
import { VARIANT_MESSAGES } from '@/lib/catalog/variant';
import { ProductImageSchema, ProductSchema } from '../product-schema';
import { pgErrorOf } from '@/db/pg-error';

/** User-facing copy, so Persian. */
export const PRODUCT_NOT_FOUND_MESSAGE = 'محصول یافت نشد';
/** A save refused by the database (duplicate slug/sku, bad category…). */
const PRODUCT_SAVE_FAILED_MESSAGE = 'محصول ذخیره نشد؛ ورودی را بررسی کن.';

/**
 * The admin view of a product: the storefront's own payload, minus the images
 * and plus the two columns only an admin sees — `isActive`, which the shop
 * expresses by simply not listing the row, and `updatedAt`.
 *
 * The images are left out because nothing needs them here: the edit page reads
 * the gallery from the DAO server-side and hands it to the form, and the two
 * image routes below answer with the gallery they just wrote. (The comment this
 * replaces promised «the panel loads those through their own endpoint», which
 * was never true — there is no admin gallery GET, and no caller wants one.)
 *
 * Derived, never restated. The two were written out field for field and this
 * story widened both copies by hand; the `Category` pair next door has already
 * drifted on `sortOrder` that way.
 */
const AdminProductSchema = ProductSchema.omit({ images: true })
  .safeExtend({
    isActive: z.boolean(),
    updatedAt: z.iso.datetime(),
  })
  .openapi('AdminProduct');

/** The admin product payload — what create and update return. */
export type AdminProductResponse = z.infer<typeof AdminProductSchema>;

/** Project a DAO row to the admin response — drops `searchText`, ISO the dates. */
const toAdminProduct = (
  p: ProductWithExtraCategories,
): AdminProductResponse => ({
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
  extraCategoryIds: p.extraCategoryIds,
  variantOf: p.variantOf,
  variantLabel: p.variantLabel,
  petTypes: p.petTypes,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

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
  // The junction's category key. Keyed on the bare field name, like every
  // entry here, because that is what the form looks an error up by — and the
  // product row is rolled back with it, since the DAO writes both in one
  // transaction.
  product_categories_category_id_categories_id_fk: `extraCategoryIds: ${PRODUCT_MESSAGES.extraCategories}`,
  // A backstop the DAO's own guard makes unreachable — but a 23503 from this
  // key means «that head is gone» either way, and it must not read as a 500.
  products_variant_of_products_id_fk: `variantOf: ${VARIANT_MESSAGES.unknownHead}`,
};

/**
 * Which form field a family refusal belongs under, or `null` for one with no
 * field to hang on — `parseFieldErrors` routes an unprefixed message to
 * `unmapped`, which the form shows in its top-level alert rather than dropping.
 *
 * Most of them are about «زیرمجموعه‌ی», the select the admin picked a head in.
 * Two are not:
 *
 * - `hasMembers` comes from the visibility checkbox or the delete button, and
 *   the form has no field for «visibility».
 * - `headNeedsLabel` depends on the request, not the rule. Sent *with* a
 *   `variantOf` it means «the head you picked has no label of its own» and
 *   belongs on that select. Sent without one it means «you cleared the label of
 *   a head that has members» — and the select is disabled for that row, so
 *   keying it there points the admin at a control they cannot use. The label
 *   field is where they can act.
 */
const variantErrorField = (
  reason: VariantRuleReason,
  variantOf: string | null,
): string | null => {
  if (reason === 'hasMembers') return null;
  if (reason === 'headNeedsLabel')
    return variantOf == null ? 'variantLabel' : 'variantOf';
  return 'variantOf';
};

/**
 * The `errors[]` detail for a known write conflict, or `null` to rethrow. Covers
 * unique (23505) and FK (23503) violations by constraint name, plus any CHECK
 * (23514) as a generic message — the input schema already blocks the CHECKs, but
 * a psql-side change could still surface one, and a 400 beats a 500. The caller
 * rethrows on `null`, so an unrecognized error stays the 500 it is.
 */
const productWriteErrors = (
  error: unknown,
  /**
   * The `variantOf` this request sent. One family rule means two different
   * things depending on it — see {@link variantErrorField} — and the mapper
   * cannot read that off the error alone.
   */
  variantOf: string | null = null,
): string[] | null => {
  // A family rule that had to read a second row, so neither zod nor a CHECK
  // could refuse it.
  if (error instanceof ProductVariantError) {
    const field = variantErrorField(error.reason, variantOf);
    return [field ? `${field}: ${error.message}` : error.message];
  }
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
    const errors = productWriteErrors(error, body.variantOf);
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
    const errors = productWriteErrors(error, body.variantOf);
    if (errors)
      return c.json(apiError(PRODUCT_SAVE_FAILED_MESSAGE, errors), 400);
    throw error;
  }
};

// ── Delete (or deactivate) ─────────────────────────────────────────────────────

export const productDeleteRoute = createRoute({
  method: 'delete',
  path: '/admin/products/{id}',
  tags: ['admin'],
  summary:
    'Delete a product nothing references, else deactivate it (admin only)',
  request: { params: IdParamSchema },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(
            productDeleteResultSchema,
            'AdminProductDeleted',
          ),
        },
      },
      description:
        'What was done: `deleted` (the row, its images and their uploaded files are gone) or `deactivated` (an order line or a family member references it, so the row stays with is_active=false)',
    },
    409: errorResponse(
      'A family head whose active members would be left with nothing to hang off',
    ),
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
  try {
    // The logic decides under the row lock: an ordered product or a family
    // head keeps its row so past order snapshots keep resolving.
    const outcome = await removeProduct(id);
    if (!outcome) return c.json(apiError(PRODUCT_NOT_FOUND_MESSAGE), 404);
    return c.json(apiSuccess({ outcome }), 200);
  } catch (error) {
    // Deactivating could not fail before families existed, so this handler had
    // no catch at all: a head with members escaped as a 500.
    //
    // The refusal is the envelope's `message`, not a field-keyed `errors[]`
    // entry — a DELETE carries no form, so there is no field to key it to, and
    // the button can show `message` directly. `categoryDeleteHandler` answers
    // its own "other rows point at it" refusal exactly this way.
    if (error instanceof ProductVariantError) {
      return c.json(apiError(error.message), 409);
    }
    throw error;
  }
};

// ── Gallery: append one photo (multipart) ─────────────────────────────────────

/**
 * Append one uploaded image to a product's gallery. Plain handler (see the file
 * header); `bodyLimit` on this path refuses an oversize body before it is
 * buffered, and this re-checks the read length as a backstop. Type is decided by
 * sniffing the bytes, never by the client's declared content-type or filename,
 * and the stored key is generated server-side — so nothing the client controls
 * reaches the path.
 *
 * One file per request, deliberately: `readImageUpload` reads a single `file`
 * field and the `bodyLimit` is mounted per *request*, so batching several files
 * into one POST would turn the 2 MB per-file ceiling into a shared cap.
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

  // The ceiling is checked here, before the body is read, and not inside
  // `appendProductImage`: a refused photo must not be buffered into memory, and
  // a check after the driver `put` would leave the file on disk with no row.
  if (product.images.length >= MAX_PRODUCT_IMAGES) {
    return c.json(apiError(PRODUCT_MESSAGES.imagesMax), 400);
  }

  // The shared trust boundary: parse the body, refuse a missing/empty/oversize
  // file, and sniff the real type from the bytes. Identical to the content
  // upload — the only difference is what happens with the bytes afterwards.
  const { bytes, type } = await readImageUpload(c);

  const stored = await appendProductImage(product, bytes, type);
  // The check above is the fast path, which keeps a refused photo from being
  // buffered at all; this is the one that still holds when two uploads race.
  // Same refusal either way, so an admin cannot tell which caught it.
  if (!stored) return c.json(apiError(PRODUCT_MESSAGES.imagesMax), 400);
  return c.json(apiSuccess(stored), 201);
};

// ── Gallery: store the order (JSON) ───────────────────────────────────────────

/**
 * One stored photo as the two gallery writes answer with it: the storefront's
 * own image row plus the URL to render it, which only the writer knows (the
 * driver resolves the key).
 *
 * Derived from `ProductImageSchema`, never restated — and under a name of its
 * own. Restating it registered a second `ProductImage` component, and
 * zod-to-openapi resolves a duplicate ref by keeping the first: the document
 * silently described this response without its `url`.
 */
const StoredImageSchema = ProductImageSchema.safeExtend({
  url: z.string(),
}).openapi('StoredProductImage');

/**
 * What a save sends back once its uploads are done: the product's photos, in the
 * admin's order, with the removed ones simply absent. It is the only write that
 * deletes a file, and it is what makes a reorder-only or a removal-only save
 * possible at all — neither carries a new file, so neither can ride the POST.
 *
 * The body is JSON, so this is an `openapi()` route with a typed handler, unlike
 * the multipart POST above.
 */
export const productImagesOrderRoute = createRoute({
  method: 'put',
  path: '/admin/products/{id}/images',
  tags: ['admin'],
  summary: "Replace a product's image order (admin only)",
  request: {
    params: IdParamSchema,
    body: {
      content: { 'application/json': { schema: productImagesOrderSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(
            z.array(StoredImageSchema),
            'ProductImagesOrdered',
          ),
        },
      },
      description: "The product's images, in the stored order",
    },
    400: errorResponse('Invalid body, or a key this product does not have'),
    401: errorResponse('No session'),
    403: errorResponse('Signed in, but not an admin'),
    404: errorResponse('No such product'),
  },
});

export const productImagesOrderHandler: RouteHandler<
  typeof productImagesOrderRoute,
  Env & AuthedEnv
> = async (c) => {
  const { id } = c.req.valid('param');
  const { objectKeys } = c.req.valid('json');

  const product = await ProductDao.findByIdForAdmin(id);
  if (!product) return c.json(apiError(PRODUCT_NOT_FOUND_MESSAGE), 404);

  // Ownership: every key has to be one this product already holds. The schema
  // can only check shape, so this is the whole gate — a key from another
  // product, a bundled `products/…` asset that is not this one's, or any other
  // string writes nothing and deletes nothing.
  const stored = await setProductImageOrder(product, objectKeys);
  if (!stored) return c.json(apiError(PRODUCT_MESSAGES.images), 400);

  return c.json(apiSuccess(stored), 200);
};
