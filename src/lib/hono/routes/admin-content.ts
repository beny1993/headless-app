// Admin storefront-content API — replace one editable block, and a shared image
// upload. Mounted under `/admin/*` behind `requireAdmin` in ../index.ts; the
// guard runs before every handler here (401 without a session, 403 without the
// admin role), so nothing below re-checks authorization.
//
// There is deliberately no public content GET: the storefront and the editor
// read through `SiteContentDao` in server components, the way `/` reads the
// catalog. This module is the write side only.
//
// `z` from `zod`, not from `@hono/zod-openapi` — see ../envelope.ts.
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import type { Context, Env } from 'hono';
import { z } from 'zod';
import { SiteContentDao } from '@/db/dao/SiteContentDao';
import {
  CONTENT_SCHEMAS,
  contentKeySchema,
  type ContentKey,
  type ContentValue,
} from '@/lib/content/site-content';
import { getStorageDriver } from '@/lib/storage';
import { objectKeyFor } from '@/lib/storage/image-upload';
import { findBrokenLinks } from '@/logic/content/link-targets';
import { INVALID_INPUT_MESSAGE } from '../create-router';
import {
  apiError,
  apiSuccess,
  apiSuccessSchema,
  formatZodIssues,
} from '../envelope';
import { errorResponse } from '../route-responses';
import { readImageUpload } from '../image-upload';
import type { AuthedEnv } from '../middleware/auth';

// ── Block update ────────────────────────────────────────────────────────────

const KeyParamSchema = z.object({
  key: contentKeySchema.meta({
    param: { name: 'key', in: 'path' },
    example: 'home.hero',
  }),
});

// The body is validated per KEY, and the path picks the key, so the OpenAPI body
// schema stays loose: one `createRoute` fronts nine value schemas. Deliberately
// NOT `z.union([...nine])` — a body failing all nine would yield nine schemas'
// worth of issues, none of which the form could map to a field. The handler
// applies exactly `CONTENT_SCHEMAS[key]` instead, so the issue paths it returns
// (`slots.0.name`, …) are the ones `parseFieldErrors` maps on the client. This is
// the one considered deviation from shipping.ts's single-schema body.
const LooseBodySchema = z.record(z.string(), z.unknown());

const ContentBlockSchema = z
  .object({ key: contentKeySchema, value: z.unknown() })
  .openapi('SiteContentBlock');

export const contentUpdateRoute = createRoute({
  method: 'put',
  path: '/admin/content/{key}',
  tags: ['admin'],
  summary: 'Replace one storefront content block (admin only)',
  request: {
    params: KeyParamSchema,
    body: {
      content: { 'application/json': { schema: LooseBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(ContentBlockSchema, 'SiteContentUpdated'),
        },
      },
      description: 'The stored block value',
    },
    400: errorResponse(
      'A body failing that key’s schema, a link to a missing category or product, or an unknown key',
    ),
    401: errorResponse('No session'),
    403: errorResponse('Signed in, but not an admin'),
  },
});

export const contentUpdateHandler: RouteHandler<
  typeof contentUpdateRoute,
  Env & AuthedEnv
> = async (c) => {
  // `key` is already narrowed to a ContentKey by the param validator; an unknown
  // key never reaches here — it fails validation and the defaultHook answers 400.
  const key = c.req.valid('param').key as ContentKey;
  const body = c.req.valid('json');

  // Widen to the base ZodType: the path picks the schema at runtime, and the
  // per-key type is recovered by the cast when calling `set` below.
  const schema: z.ZodType = CONTENT_SCHEMAS[key];
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // The defaultHook's exact envelope, so the client maps `path: message`
    // issues back onto the offending field.
    return c.json(
      apiError(INVALID_INPUT_MESSAGE, formatZodIssues(parsed.error)),
      400,
    );
  }

  // The schema proved each link id is a uuid; whether it names a category or an
  // active product is a catalog question, answered before anything is stored —
  // in the same envelope, so the editor maps `cards.2.link: …` onto the card.
  const brokenLinks = await findBrokenLinks(parsed.data);
  if (brokenLinks.length > 0) {
    return c.json(apiError(INVALID_INPUT_MESSAGE, brokenLinks), 400);
  }

  // `set` re-parses (its own last-boundary), so the cast only bridges the
  // union-of-generics gap; the runtime value is exactly what the schema produced.
  const value = await SiteContentDao.set(
    key,
    parsed.data as ContentValue<ContentKey>,
  );
  return c.json(apiSuccess({ key, value }), 200);
};

// ── Image upload (multipart) ──────────────────────────────────────────────────

/**
 * Store one uploaded content image and return its key + URL. Plain handler (like
 * the product upload), behind the same admin guard and a `bodyLimit` mounted on
 * this path; it shares the product route's trust boundary via `readImageUpload`
 * (parse → sniff → size), differing only in that it records NO database row —
 * the key travels back to the form, which then saves it into a block via the PUT
 * above, where `imageKeySchema` re-validates its shape regardless.
 */
export const contentImageUploadHandler = async (
  c: Context<Env & AuthedEnv>,
): Promise<Response> => {
  const upload = await readImageUpload(c);
  if (!upload.ok) return upload.response;

  const driver = getStorageDriver();
  const key = objectKeyFor(upload.type);
  await driver.put(key, upload.bytes, upload.type);

  // ponytail: no orphan sweep — an upload whose block is never saved, or a
  // replaced uploads/ key, is left on disk. Keys are uuids used by at most one
  // slot (the form cannot copy a key), so a sweep would be safe.
  //
  // The product gallery's `setProductImageOrder` is the nearest worked example,
  // but only half of it transfers. Its shape: delete exactly what the write
  // itself removed (`previous − kept`, as `ProductDao.setImages` reports it),
  // restricted to `uploads/` so a bundled `products/…` asset is never handed to
  // the driver, each failure swallowed and reported to Sentry rather than
  // failing a write the database has already taken. What does not transfer is
  // where that set comes from: a gallery has `product_images` rows to diff, and
  // content images are keys inside `site_content` JSON with no row of their
  // own. A sweep here has to collect the referenced keys by walking the saved
  // values — every area, every block — and delete the `uploads/` objects no
  // value names. Until disk fills, it is not worth that walk.
  return c.json(apiSuccess({ key, url: driver.url(key) }), 201);
};
