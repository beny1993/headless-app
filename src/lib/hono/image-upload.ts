// The image-upload trust boundary, expressed once as a server helper every
// upload route calls — the product route (`admin-products.ts`), the content
// route (`admin-content.ts`) and the payment receipt route (`receipts.ts`). It
// reads the multipart body, refuses a missing or empty file, backstops the size
// ceiling under the mounted `bodyLimit`, and — the part the security pass leans
// on — decides the type by SNIFFING the bytes, never the client's declared
// content-type or filename.
//
// It takes a Hono `Context`, so it lives here and NOT in `@/lib/storage/image-upload`,
// which is client-safe by contract (the admin form imports the accept list and
// size cap from there). The user-facing messages moved here with it — they belong
// to the boundary, and every upload route answers with them.
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  IMAGE_FIELD_NAME,
  IMAGE_TYPE_ERROR,
  MAX_UPLOAD_BYTES,
  sniffImageType,
  type AcceptedImageType,
} from '@/lib/storage/image-upload';

/** No usable image file on an upload request. */
export const NO_IMAGE_FILE_MESSAGE = 'فایلی برای بارگذاری ارسال نشده است.';
/** The uploaded bytes are not one of the accepted image formats. */
export const INVALID_IMAGE_MESSAGE = `${IMAGE_TYPE_ERROR.replace(/\.$/, '')} پذیرفته می‌شود.`;
/** The uploaded file is larger than the allowed size. */
export const IMAGE_TOO_LARGE_MESSAGE = 'حجم تصویر بیش از حد مجاز است.';

/**
 * The validated bytes and sniffed type of an uploaded image. A refusal throws an
 * `HTTPException` (400, or 413 past `maxBytes`), which `apiErrorHandler`
 * answers as the error envelope with its message and status. The caller stores
 * `bytes` under a server-generated key for `type`.
 *
 * The size check re-reads the file's own length even though the route mounts a
 * `bodyLimit`: the guard refuses an oversize body before it is buffered, and
 * this keeps the ceiling enforced — exactly, on the file rather than the whole
 * multipart body — if a caller ever reaches the handler off that guarded path.
 * The product photos' two megabytes by default; a payment receipt's five.
 */
export async function readImageUpload(
  c: Context,
  maxBytes: number = MAX_UPLOAD_BYTES,
): Promise<{ bytes: Uint8Array; type: AcceptedImageType }> {
  const form = await c.req.parseBody();
  const file = form[IMAGE_FIELD_NAME];
  if (!(file instanceof File)) {
    throw new HTTPException(400, { message: NO_IMAGE_FILE_MESSAGE });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new HTTPException(400, { message: NO_IMAGE_FILE_MESSAGE });
  }
  if (bytes.byteLength > maxBytes) {
    throw new HTTPException(413, { message: IMAGE_TOO_LARGE_MESSAGE });
  }

  const type = sniffImageType(bytes);
  if (!type) throw new HTTPException(400, { message: INVALID_IMAGE_MESSAGE });

  return { bytes, type };
}
