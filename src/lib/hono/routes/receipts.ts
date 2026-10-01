// Card-to-card payment receipts: the shopper's upload, and the two byte routes
// that are the ONLY way a receipt is ever read — the order's owner, or an
// admin. There is no public URL for a receipt anywhere (see
// `src/lib/storage/image-url.ts`); these answer `private, no-store`, so no
// shared cache or CDN ever holds one.
//
// Plain handlers, like the product image upload (`admin-products.ts`): the
// upload's body is read by `readImageUpload`, the trust boundary every upload
// route shares (the type sniffed from the bytes, the exact size cap), and only
// after the receipt gate and the body limit have let it through; the reads
// answer raw image bytes, not the JSON envelope. So every path segment is
// parsed with zod here, before anything touches the database, and the guards
// are the mounts in ../index.ts — `requireAuth` on `/orders/:id/*` (the
// owner's id is `c.get('user').id`, never the URL or the body), `requireAdmin`
// on `/admin/*`, and the gate and the body limit on the upload.
import type { Context, Env, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { MAX_RECEIPT_BYTES, RECEIPT_CAP_MESSAGE } from '@/lib/orders/receipt';
import {
  readReceipt,
  receiptUploadGate,
  uploadReceipt,
} from '@/logic/orders/receipts';
import { apiError, apiSuccess } from '../envelope';
import { readImageUpload } from '../image-upload';
import type { AuthedEnv } from '../middleware/auth';

/** User-facing copy, so Persian. Missing and not-yours are one answer. */
const ORDER_NOT_FOUND_MESSAGE = 'سفارش یافت نشد';
const RECEIPT_NOT_FOUND_MESSAGE = 'رسید یافت نشد';
const NOT_ACCEPTING_MESSAGE = 'این سفارش رسید نمی‌پذیرد.';
/** Storage could not keep the receipt private — there is still a way to send it. */
const RECEIPT_UNAVAILABLE_MESSAGE =
  'بارگذاری رسید موقتاً ممکن نیست؛ رسید را از طریق اینستاگرام یا تلگرام بفرست.';

type AuthedContext = Context<Env & AuthedEnv>;

const orderIdSchema = z.uuid();
const receiptParamsSchema = z.object({ id: z.uuid(), receiptId: z.uuid() });

/**
 * `POST /orders/{id}/receipts`, first step: the id's shape, who owns the order
 * and whether it takes one more receipt (`receiptUploadGate`). Mounted as the
 * route's own middleware AHEAD of its body limit (../index.ts), because the
 * body limit reads a body with no Content-Length in full before it lets the
 * request on: a refused upload must not cost its body.
 */
export const orderReceiptUploadGate: MiddlewareHandler<
  Env & AuthedEnv
> = async (c, next) => {
  const orderId = orderIdSchema.safeParse(c.req.param('id'));
  if (!orderId.success) {
    return c.json(apiError(ORDER_NOT_FOUND_MESSAGE), 400);
  }

  const gate = await receiptUploadGate(orderId.data, c.get('user').id);
  switch (gate.outcome) {
    case 'not_found':
      return c.json(apiError(ORDER_NOT_FOUND_MESSAGE), 404);
    case 'not_accepting':
      return c.json(apiError(NOT_ACCEPTING_MESSAGE), 409);
    case 'cap_reached':
      return c.json(apiError(RECEIPT_CAP_MESSAGE), 409);
  }
  await next();
};

/**
 * `POST /orders/{id}/receipts`, last step, behind the gate and the body limit:
 * the body is read (sniffed, capped at exactly MAX_RECEIPT_BYTES) and stored.
 * The store checks the owner, the method and the status again under the
 * order's lock, and the cap as it inserts — the gate is the fast path.
 */
export const orderReceiptUploadHandler = async (
  c: AuthedContext,
): Promise<Response> => {
  const orderId = orderIdSchema.safeParse(c.req.param('id'));
  if (!orderId.success) return c.json(apiError(ORDER_NOT_FOUND_MESSAGE), 400);

  const { bytes, type } = await readImageUpload(c, MAX_RECEIPT_BYTES);

  const result = await uploadReceipt(
    orderId.data,
    c.get('user').id,
    bytes,
    type,
  );
  switch (result.outcome) {
    case 'not_found':
      return c.json(apiError(ORDER_NOT_FOUND_MESSAGE), 404);
    case 'not_accepting':
      return c.json(apiError(NOT_ACCEPTING_MESSAGE), 409);
    case 'cap_reached':
      return c.json(apiError(RECEIPT_CAP_MESSAGE), 409);
    case 'exposed':
      return c.json(apiError(RECEIPT_UNAVAILABLE_MESSAGE), 503);
    case 'ok':
      return c.json(
        apiSuccess({
          id: result.receipt.id,
          createdAt: result.receipt.createdAt.toISOString(),
        }),
        201,
      );
  }
};

/**
 * One receipt's bytes, from `lookup` — which decides who may have them. The
 * headers are the point: the type the receipt's key names (`readReceipt` reads
 * it off the extension, which the upload minted from the sniffed bytes — never
 * the row's `content_type`), never re-guessed by the browser, and `private,
 * no-store`, so the bytes are kept by nobody between the app and the one person
 * allowed to see them.
 */
const serveReceipt = async (
  c: AuthedContext,
  lookup: (
    orderId: string,
    receiptId: string,
  ) => Promise<{ contentType: string; bytes: Uint8Array } | null>,
): Promise<Response> => {
  const params = receiptParamsSchema.safeParse(c.req.param());
  if (!params.success) return c.json(apiError(RECEIPT_NOT_FOUND_MESSAGE), 400);

  const found = await lookup(params.data.id, params.data.receiptId);
  if (!found) return c.json(apiError(RECEIPT_NOT_FOUND_MESSAGE), 404);

  return c.body(new Uint8Array(found.bytes), 200, {
    'Content-Type': found.contentType,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
};

/**
 * `GET /orders/{id}/receipts/{receiptId}` — for the order's owner only. Another
 * customer's receipt is a 404, word for word the one a missing receipt gets.
 */
export const orderReceiptHandler = (c: AuthedContext) =>
  serveReceipt(c, (orderId, receiptId) =>
    readReceipt(orderId, receiptId, { userId: c.get('user').id }),
  );

/** `GET /admin/orders/{id}/receipts/{receiptId}` — for any admin. */
export const adminOrderReceiptHandler = (c: AuthedContext) =>
  serveReceipt(c, (orderId, receiptId) =>
    readReceipt(orderId, receiptId, 'admin'),
  );
