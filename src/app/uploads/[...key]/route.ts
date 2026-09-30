// Serves the local storage driver's uploaded images at `/uploads/<uuid>.<ext>`.
// This is the read half of the `local` driver (its write half is `put`); when the
// S3-compatible driver is selected, `imageSrc(key)` points the browser straight at
// the bucket and this route is simply never hit.
//
// It is a trust boundary, so it is defensive by construction: the only thing it
// will serve is a filename shaped exactly like a key we generated — a uuid plus
// one of our three extensions. Anything else (a traversal segment, a subpath, a
// dotfile, an unknown extension) is a 404, and the read itself re-asserts the
// resolved path stays inside the storage root. `Content-Type` is set from that
// whitelisted extension and never sniffed by the browser.
import {
  contentTypeOfKey,
  UPLOAD_FILENAME_PATTERN,
} from '@/lib/storage/image-upload';
import { readLocalUpload } from '@/lib/storage/local-driver';

// Reads the filesystem per request; never fold into the build output.
export const dynamic = 'force-dynamic';

const notFound = () => new Response('Not found', { status: 404 });

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ key: string[] }> },
) {
  const { key } = await ctx.params;
  const filename = key.join('/');

  // The shape gate: a uuid filename with an accepted extension, nothing else.
  // A traversal (`..`), a slash (subpath), or a stray extension never reaches
  // the filesystem.
  if (!UPLOAD_FILENAME_PATTERN.test(filename)) return notFound();

  const contentType = contentTypeOfKey(filename);
  if (!contentType) return notFound();

  const bytes = await readLocalUpload(filename);
  if (!bytes) return notFound();

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      // Keys are content-unique uuids, so a stored file never changes under its
      // URL — cache it hard.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
