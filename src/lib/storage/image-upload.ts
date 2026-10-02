// The upload trust boundary, expressed once and shared by the API route (which
// enforces it) and the admin form (which uses the same accept list and size cap
// so a file the browser lets through is one the server will too). Deliberately
// client-safe: no `fs`, no `@/db`, no driver import, so the form can pull the
// constants without dragging Node built-ins into the browser bundle.
//
// The rule the security pass leans on: what a file *is* comes from its bytes,
// never from the client's declared `Content-Type` or its filename. `sniffImageType`
// is the only thing that decides the type, and `objectKeyFor` derives the stored
// key from that sniffed type — so a `.php` renamed to `.jpg`, or a `text/html`
// with an image extension, is rejected, and the key we persist can never carry an
// attacker-chosen extension.
import { z } from 'zod';
import { formatNumber } from '@/lib/format';

/** The image content types the shop accepts, mapped to the extension we store. */
export const IMAGE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export type AcceptedImageType = keyof typeof IMAGE_EXTENSIONS;

/** For the form's `accept` attribute and the reject message. */
export const ACCEPTED_IMAGE_TYPES = Object.keys(
  IMAGE_EXTENSIONS,
) as AcceptedImageType[];

const TYPE_BY_EXTENSION = new Map<string, AcceptedImageType>(
  Object.entries(IMAGE_EXTENSIONS).map(([type, extension]) => [
    extension,
    type as AcceptedImageType,
  ]),
);

/**
 * The content type a stored key is served with, from its extension — which
 * `objectKeyFor` minted from the sniffed bytes — or `null` for any other
 * extension. What the serving routes answer with, never a stored or declared
 * type.
 */
export const contentTypeOfKey = (key: string): AcceptedImageType | null =>
  TYPE_BY_EXTENSION.get(key.slice(key.lastIndexOf('.') + 1)) ?? null;

/**
 * The multipart field the image arrives in. Shared by the upload route (which
 * reads it) and the admin form (which sets it) — here rather than in the route
 * module because the form is a client component and must not import the route
 * (it would drag `pg` into the browser bundle).
 */
export const IMAGE_FIELD_NAME = 'file';

/**
 * Two megabytes, the ceiling the design's upload hint promises («تا ۲ مگابایت»).
 * The route mounts `bodyLimit` at this number so an oversize body is refused
 * before it is ever buffered into memory, and re-checks the read length as a
 * backstop.
 */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/**
 * The one path segment every stored image key begins with. It is both the URL
 * namespace (`/uploads/…`, served by `src/app/uploads/[...key]/route.ts`) and
 * the local driver's storage root, so a key is `uploads/<uuid>.<ext>` and the
 * file that backs it is `<root>/<uuid>.<ext>`.
 */
export const UPLOAD_KEY_PREFIX = 'uploads';

/**
 * Where a card-to-card payment receipt is stored: `receipts/<uuid>.<ext>` — the
 * local driver's `<root>/receipts/` folder, the bucket's `receipts/` prefix. It
 * is **never** a public namespace: no URL resolves a receipt key (`imageSrc`
 * and every driver's `url()` throw on one), and only the authenticated receipt
 * routes read one back, for the order's owner and the admins.
 */
export const RECEIPT_KEY_PREFIX = 'receipts';

/** Whether `key` names a receipt — private by construction, see above. */
export const isReceiptKey = (key: string): boolean =>
  key.startsWith(`${RECEIPT_KEY_PREFIX}/`);

/**
 * The filename half of a stored upload key: a v4 uuid and one of our extensions,
 * nothing else. The route validates the requested key against this before it
 * touches the filesystem, so a traversal segment (`..`, a slash, a leading dot)
 * or any other shape is a 404, not a file read. Seed keys like
 * `products/cat-dry-food.jpg` deliberately do not match — they are served from
 * `public/`, never through the uploads route.
 */
export const UPLOAD_FILENAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

const startsWith = (bytes: Uint8Array, signature: number[]): boolean =>
  signature.every((byte, index) => bytes[index] === byte);

// ASCII for "RIFF" (bytes 0–3) and "WEBP" (bytes 8–11) in a RIFF container.
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

/**
 * How many leading bytes `sniffImageType` reads: up to WEBP's tag at 8–11. A
 * browser-side check slices this much off a picked file instead of reading all
 * of it.
 */
export const SNIFF_LENGTH = 12;

/**
 * The image type a file actually is, read from its leading bytes — or `null`
 * when the bytes are not one of the three we accept. This is the authority on
 * type; the caller's declared content-type is never trusted.
 */
export function sniffImageType(bytes: Uint8Array): AcceptedImageType | null {
  // JPEG: FF D8 FF. PNG: 89 50 4E 47 0D 0A 1A 0A.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  // WEBP is a RIFF container tagged "WEBP" at offset 8; both markers are
  // required so a plain WAV/AVI RIFF file is not mistaken for an image.
  if (startsWith(bytes, RIFF) && WEBP.every((b, i) => bytes[i + 8] === b)) {
    return 'image/webp';
  }
  return null;
}

/**
 * A fresh storage key for an image of the given (sniffed) type:
 * `uploads/<uuid>.<ext>`, or `receipts/<uuid>.<ext>` for a payment receipt. The
 * uuid is generated here, on the server, so nothing the client sent — filename,
 * path, extension — reaches the stored key. That is what makes a path-traversal
 * key impossible to produce.
 */
export function objectKeyFor(
  type: AcceptedImageType,
  prefix:
    typeof UPLOAD_KEY_PREFIX | typeof RECEIPT_KEY_PREFIX = UPLOAD_KEY_PREFIX,
): string {
  return `${prefix}/${crypto.randomUUID()}.${IMAGE_EXTENSIONS[type]}`;
}

/**
 * A bundled asset committed under `public/`, the other shape a stored key can
 * take: `site/…` or `products/…`.
 */
const BUNDLED_IMAGE_KEY = /^(site|products)\/[a-z0-9-]+\.(jpe?g|png|webp)$/;

/** The longest key anything here can produce, with room to spare. */
export const MAX_OBJECT_KEY_LENGTH = 200;

/** The refusal for a stored key that is not one, whatever made it wrong. */
export const IMAGE_KEY_ERROR = 'کلید تصویر نامعتبر است.';

/**
 * What a valid stored image key looks like, for every caller that takes one
 * from a client. Anchored to exactly the two shapes a key can have and derived
 * from the uploader's own constants above — so adding an accepted type widens
 * this for free, and no second answer to «is this a key» can drift from it.
 * The message sits on the base type and the cap too, or a wrong type or an
 * overlong key would answer in zod's English.
 *
 * Client-safe, like everything else in this module.
 */
export const imageKeySchema = z
  .string({ error: IMAGE_KEY_ERROR })
  .max(MAX_OBJECT_KEY_LENGTH, IMAGE_KEY_ERROR)
  .refine(
    (key) =>
      BUNDLED_IMAGE_KEY.test(key) ||
      (key.startsWith(`${UPLOAD_KEY_PREFIX}/`) &&
        UPLOAD_FILENAME_PATTERN.test(key.slice(UPLOAD_KEY_PREFIX.length + 1))),
    { error: IMAGE_KEY_ERROR },
  );

/**
 * What the shared admin image upload answers: the stored key, for the form to
 * save into its own body, and a URL to preview it by. Declared once, for the
 * route to build its reply from and the client to parse it with, so the two
 * cannot drift apart.
 */
export const imageUploadResultSchema = z.object({
  key: imageKeySchema,
  url: z.string(),
});
export type ImageUploadResult = z.infer<typeof imageUploadResultSchema>;

/**
 * Megabytes for the copy below, to one decimal place. Rounded because the
 * division is exact only for a power-of-two cap: a 5,000,000-byte ceiling
 * would otherwise print «۴.۷۶۸۳۷۱۵۸۲۰۳۱۲۵ مگابایت» in the field an admin is
 * reading. Through `formatNumber`, not `toPersianDigits`, because a fraction
 * needs the fa-IR decimal separator — `toPersianDigits` would leave a Latin
 * full stop on a screen where every other number uses «٫».
 */
const megabytes = (maxBytes: number) =>
  formatNumber(Math.round((maxBytes / 1024 / 1024) * 10) / 10);

/**
 * The accepted formats as the admin reads them, derived from the one list that
 * decides them. Typing them out meant two copies three lines apart that
 * already disagreed on JPG versus JPEG, and that would both go on naming three
 * formats the day a fourth was accepted.
 */
const ACCEPTED_LABELS = ((labels: string[]) =>
  labels.length > 1
    ? // Persian lists the last item after «یا», not another comma.
      `${labels.slice(0, -1).join('، ')} یا ${labels[labels.length - 1]}`
    : (labels[0] ?? ''))([
  ...new Set(Object.values(IMAGE_EXTENSIONS).map((ext) => ext.toUpperCase())),
]);

/**
 * The accept-and-size hint an image field shows, and the size refusal, for a
 * given ceiling — the product photos' below, a payment receipt's in
 * `src/lib/orders/receipt.ts`. Derived rather than written out: three
 * hand-typed copies of «۲ مگابایت» went on promising two megabytes after the
 * cap moved, in the very field the admin was looking at while a larger file
 * uploaded fine.
 */
export const formatHint = (maxBytes: number) =>
  `${ACCEPTED_LABELS}، تا ${megabytes(maxBytes)} مگابایت`;
export const sizeError = (maxBytes: number) =>
  `حجم تصویر باید حداکثر ${megabytes(maxBytes)} مگابایت باشد.`;

export const IMAGE_FORMAT_HINT = formatHint(MAX_UPLOAD_BYTES);
export const IMAGE_TYPE_ERROR = `فقط تصویر ${ACCEPTED_LABELS}.`;
export const IMAGE_SIZE_ERROR = sizeError(MAX_UPLOAD_BYTES);
