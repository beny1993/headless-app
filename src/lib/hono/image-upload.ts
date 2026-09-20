// The image-upload trust boundary, expressed once as a server helper both admin
// upload routes call — the product route (`admin-products.ts`) and the content
// route (`admin-content.ts`). It reads the multipart body, refuses a missing or
// empty file, backstops the size ceiling under the mounted `bodyLimit`, and — the
// part the security pass leans on — decides the type by SNIFFING the bytes, never
// the client's declared content-type or filename.
//
// It takes a Hono `Context`, so it lives here and NOT in `@/lib/storage/image-upload`,
// which is client-safe by contract (the admin form imports the accept list and
// size cap from there). The user-facing messages moved here with it — they belong
// to the boundary, and both routes answer with them.
import type { Context } from 'hono';
import {
  IMAGE_FIELD_NAME,
  IMAGE_TYPE_ERROR,
  MAX_UPLOAD_BYTES,
  sniffImageType,
  type AcceptedImageType,
} from '@/lib/storage/image-upload';
import { apiError } from './envelope';

/** No usable image file on an upload request. */
export const NO_IMAGE_FILE_MESSAGE = 'فایلی برای بارگذاری ارسال نشده است.';
/** The uploaded bytes are not one of the accepted image formats. */
export const INVALID_IMAGE_MESSAGE = `${IMAGE_TYPE_ERROR.replace(/\.$/, '')} پذیرفته می‌شود.`;
/** The uploaded file is larger than the allowed size. */
export const IMAGE_TOO_LARGE_MESSAGE = 'حجم تصویر بیش از حد مجاز است.';

/**
 * The validated bytes and sniffed type of an uploaded image, or a ready-to-return
 * error `Response`. The caller returns `response` unchanged on `ok: false`, and
 * on `ok: true` stores `bytes` under a server-generated key for `type`.
 *
 * The size backstop re-checks the read length even though the route mounts a
 * `bodyLimit` at the same ceiling: the guard refuses an oversize body before it
 * is buffered, and this keeps the ceiling enforced if a caller ever reaches the
 * handler off that guarded path.
 */
export type ImageUploadResult =
  | { ok: true; bytes: Uint8Array; type: AcceptedImageType }
  | { ok: false; response: Response };

export async function readImageUpload(c: Context): Promise<ImageUploadResult> {
  const form = await c.req.parseBody();
  const file = form[IMAGE_FIELD_NAME];
  if (!(file instanceof File)) {
    return {
      ok: false,
      response: c.json(apiError(NO_IMAGE_FILE_MESSAGE), 400),
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) {
    return {
      ok: false,
      response: c.json(apiError(NO_IMAGE_FILE_MESSAGE), 400),
    };
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      response: c.json(apiError(IMAGE_TOO_LARGE_MESSAGE), 413),
    };
  }

  const type = sniffImageType(bytes);
  if (!type) {
    return {
      ok: false,
      response: c.json(apiError(INVALID_IMAGE_MESSAGE), 400),
    };
  }

  return { ok: true, bytes, type };
}
