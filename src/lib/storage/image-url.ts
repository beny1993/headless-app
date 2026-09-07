// Turn a stored object key into a URL the browser can load. **Client-safe** (no
// `fs`, no driver, no `@aws-sdk`): render sites import this, never the driver, so
// nothing server-only is dragged into the browser bundle — and the cart, which
// is localStorage-backed and renders on the client, can resolve URLs too.
//
// The rule: bundled assets (`site/…`, `products/…`) always live under `public/`
// and resolve root-relative in every mode; only `uploads/…` objects can live in
// object storage, and only when a public base is configured (production `s3`).
// With no base set (local dev/test), every key is root-relative and the local
// serving route (`src/app/uploads/[...key]/route.ts`) answers `/uploads/*`.
//
// `NEXT_PUBLIC_STORAGE_BASE_URL` is build-time inlined, so this same function
// returns byte-identical URLs on the server and the client (the storage driver's
// `url()` delegates here for exactly that reason). It must be set to
// `${LIARA_ENDPOINT}/${LIARA_BUCKET_NAME}` when the provider is `s3`.
import { getEnvVariable, VARS } from '@/lib/utils/env';
import { UPLOAD_KEY_PREFIX } from './image-upload';

export function imageSrc(key: string): string {
  const base = getEnvVariable(VARS.NEXT_PUBLIC_STORAGE_BASE_URL, false, '');
  if (base && key.startsWith(`${UPLOAD_KEY_PREFIX}/`)) {
    return `${base}/${key}`;
  }
  return `/${key}`;
}
