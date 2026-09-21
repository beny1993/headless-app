// Admin discount-code CRUD — create a code and toggle it active/inactive. Mounted
// under `/admin/*` behind `requireAdmin` in ../index.ts; the guard runs before
// every handler here (401 without a session, 403 without the admin role), so
// nothing below re-checks authorization.
//
// Route pattern as elsewhere (./admin-products.ts, ./shipping.ts): a `createRoute`
// definition plus a separate typed `RouteHandler`. The bodies are the shared,
// client-safe `@/lib/discount/discount-code` schemas — imported, never restated,
// so the admin form validates against the very rules the API enforces, and the
// create body is mass-assignment-safe (no `usageCount`, no `id`). `z` from `zod`,
// not from `@hono/zod-openapi` (see ../envelope.ts).
//
// There is no admin GET route: the admin page reads `DiscountCodeDao.listForAdmin`
// server-side (like the shipping editor reads its rates), so only the two
// mutations need an endpoint. Codes are never hard-deleted — they are
// order-snapshotted by amount + string — so "delete" is a deactivate via toggle.
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import type { Env } from 'hono';
import { z } from 'zod';
import { DiscountCodeDao } from '@/db/dao/DiscountCodeDao';
import {
  discountCodeInputSchema,
  discountCodeToggleSchema,
  discountCodeViewSchema,
  toDiscountView,
} from '@/lib/discount/discount-code';
import { apiError, apiSuccess, apiSuccessSchema } from '../envelope';
import { errorResponse, IdParamSchema } from '../route-responses';
import type { AuthedEnv } from '../middleware/auth';
import { pgErrorOf } from '../pg-error';

/** User-facing copy, so Persian. */
export const DISCOUNT_NOT_FOUND_MESSAGE = 'کد تخفیف یافت نشد.';
/** A save refused by the database (a duplicate code, or a CHECK). */
export const DISCOUNT_SAVE_FAILED_MESSAGE =
  'کد تخفیف ذخیره نشد؛ ورودی را بررسی کن.';

/**
 * The shape lives in `@/lib/discount/discount-code`: one definition, client-safe,
 * so the server page that renders the first paint projects rows without
 * importing this file. Rebuilt into a local `z.object` before `.openapi()`: that method is
 * grafted on by `@hono/zod-openapi` and zod 4 hands it to newly built schemas
 * only, so calling it on an imported one depends on module evaluation order
 * (the trap documented above `ProductListQuerySchema` in ./catalog.ts).
 *
 * The ceiling that buys: `.shape` copies the FIELDS. An object-level modifier
 * on the source schema — `.strict()`, `.catchall()`, `.refine()`, a `.meta()`
 * on the object itself — is silently left behind, and the document would drift
 * with no failing test. None of the five projections has one today. Add one
 * there and it has to be repeated here, or the two stop being one definition.
 */
const DiscountCodeSchema = z
  .object(discountCodeViewSchema.shape)
  .openapi('DiscountCode');

/** Re-exported for the client components that already import the type here. */
export type { DiscountCodeView } from '@/lib/discount/discount-code';

// ── Postgres write-error mapping (as in admin-products) ───────────────────────
/**
 * The `errors[]` detail for a known write conflict, or `null` to rethrow. A
 * duplicate code (23505) is field-scoped; any CHECK (23514) — the value/min/limit
 * bounds the input schema already blocks, but psql could still surface — is a
 * generic 400 rather than a 500. Unknown errors rethrow as the 500 they are.
 */
export const discountWriteErrors = (error: unknown): string[] | null => {
  const pg = pgErrorOf(error);
  if (!pg) return null;
  if (pg.code === '23505' && pg.constraint === 'discount_codes_code_unique') {
    return ['code: این کد قبلاً ثبت شده است.'];
  }
  if (pg.code === '23514') {
    return ['ورودی نامعتبر است — محدودیت پایگاه داده نقض شد.'];
  }
  return null;
};

// ── Create ─────────────────────────────────────────────────────────────────────

export const discountCreateRoute = createRoute({
  method: 'post',
  path: '/admin/discounts',
  tags: ['admin'],
  summary: 'Create a discount code (admin only)',
  request: {
    body: {
      content: { 'application/json': { schema: discountCodeInputSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(DiscountCodeSchema, 'DiscountCreated'),
        },
      },
      description: 'The created code',
    },
    400: errorResponse('Invalid body, or a duplicate code'),
    401: errorResponse('No session'),
    403: errorResponse('Signed in, but not an admin'),
  },
});

export const discountCreateHandler: RouteHandler<
  typeof discountCreateRoute,
  Env & AuthedEnv
> = async (c) => {
  const body = c.req.valid('json');
  try {
    const created = await DiscountCodeDao.create(body);
    return c.json(apiSuccess(toDiscountView(created)), 201);
  } catch (error) {
    const errors = discountWriteErrors(error);
    if (errors)
      return c.json(apiError(DISCOUNT_SAVE_FAILED_MESSAGE, errors), 400);
    throw error;
  }
};

// ── Toggle active (deactivate / reactivate) ──────────────────────────────────────

export const discountToggleRoute = createRoute({
  method: 'patch',
  path: '/admin/discounts/{id}',
  tags: ['admin'],
  summary: 'Activate or deactivate a discount code (admin only)',
  request: {
    params: IdParamSchema,
    body: {
      content: { 'application/json': { schema: discountCodeToggleSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(DiscountCodeSchema, 'DiscountToggled'),
        },
      },
      description: 'The updated code',
    },
    400: errorResponse('Invalid body'),
    401: errorResponse('No session'),
    403: errorResponse('Signed in, but not an admin'),
    404: errorResponse('No such code'),
  },
});

export const discountToggleHandler: RouteHandler<
  typeof discountToggleRoute,
  Env & AuthedEnv
> = async (c) => {
  const { id } = c.req.valid('param');
  const { isActive } = c.req.valid('json');
  // Only `is_active` is writable post-creation. `usageCount`, `value`, `code`
  // and the rest are immutable here by construction — the body schema names one
  // field — so no admin write can raise a limit or pre-exhaust a code.
  const updated = await DiscountCodeDao.setActive(id, isActive);
  if (!updated) return c.json(apiError(DISCOUNT_NOT_FOUND_MESSAGE), 404);
  return c.json(apiSuccess(toDiscountView(updated)), 200);
};
