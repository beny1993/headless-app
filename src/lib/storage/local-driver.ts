// The local-disk storage driver — the shipped default, so image upload works on
// local and test deployments with no object-storage account (the same reason the
// SMS console driver and the Zarinpal mock driver are the defaults).
//
// It is a real driver, not a stub: it writes the bytes to a configured root and
// the serving route (`src/app/uploads/[...key]/route.ts`) reads them back. What
// makes it safe is that it never trusts a caller for a filesystem path — every
// key is reduced to a single filename under the root and the resolved path is
// re-asserted to stay inside it, so neither a stored key nor a URL segment can
// walk out of the storage directory.
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getEnvVariable, VARS } from '@/lib/utils/env';
import {
  isReceiptKey,
  RECEIPT_KEY_PREFIX,
  UPLOAD_KEY_PREFIX,
} from './image-upload';
import type { StorageDriver } from './index';

/** Thrown when a key/filename would escape the storage root or the namespace. */
export class StorageKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageKeyError';
  }
}

const DEFAULT_LOCAL_ROOT = 'uploads';

/**
 * The absolute storage root, resolved per call (not memoized at import) so a
 * test can point it at a temp dir and a deployment can set it without a rebuild.
 */
export const localStorageRoot = (): string =>
  path.resolve(
    getEnvVariable(
      VARS.APP_CONFIG_STORAGE_LOCAL_ROOT,
      false,
      DEFAULT_LOCAL_ROOT,
    ),
  );

/**
 * Absolute file for a filename *relative to the root*, refusing anything that
 * resolves outside it. `path.resolve` collapses any `..`, so a crafted name is
 * caught by the `startsWith(root + sep)` assertion rather than reaching disk.
 * This is the single choke point every read and write goes through.
 */
const resolveUnderRoot = (relative: string): string => {
  const root = localStorageRoot();
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) {
    throw new StorageKeyError(`path escapes the storage root: ${relative}`);
  }
  return file;
};

/**
 * Where a key lives relative to the root, or a refusal. Two namespaces only:
 *
 *   · `uploads/<name>` → `<root>/<name>` — what `/uploads/*` serves publicly;
 *   · `receipts/<name>` → `<root>/receipts/<name>` — a folder that route can
 *     never reach (it serves one flat filename, and this is two segments).
 *
 * `<name>` must be one flat filename. A seed product's `products/…` key (served
 * from `public/`, never through this driver) is rejected, so a "change image"
 * on a bundled product can never delete a committed asset — and so is
 * `receipts/../x.jpg`, which resolves inside the root, straight into the public
 * uploads folder, and would pass the root check alone.
 */
const relativePathFromKey = (key: string): string => {
  for (const [prefix, folder] of [
    [UPLOAD_KEY_PREFIX, ''],
    [RECEIPT_KEY_PREFIX, `${RECEIPT_KEY_PREFIX}/`],
  ] as const) {
    if (!key.startsWith(`${prefix}/`)) continue;
    const name = key.slice(prefix.length + 1);
    if (name === '' || name.includes('/') || name.includes('..')) {
      throw new StorageKeyError(`not a flat ${prefix} key: ${key}`);
    }
    return `${folder}${name}`;
  }
  throw new StorageKeyError(`not an uploads or receipts key: ${key}`);
};

export const localDriver: StorageDriver = {
  // `contentType` is unused here: the extension we chose from the sniffed type
  // is authoritative, and the serving route derives the response type from it.
  // The S3 driver will send it on the PUT — the parameter is the seam's, not
  // this implementation's.
  async put(key, data) {
    const file = resolveUnderRoot(relativePathFromKey(key));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  },

  async get(key) {
    const bytes = await readUnderRoot(relativePathFromKey(key));
    return bytes && new Uint8Array(bytes);
  },

  async delete(key) {
    const file = resolveUnderRoot(relativePathFromKey(key));
    try {
      await unlink(file);
    } catch (error) {
      // Already gone is success — deletes are idempotent (a retried cleanup, a
      // row whose file was pruned). Anything else is a real failure.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  },

  // The storefront resolves an object key as a root-relative URL (`/${key}`),
  // and the key already carries the `uploads/` namespace the serving route is
  // mounted on — so this is the whole mapping. A receipt has no URL.
  url(key) {
    if (isReceiptKey(key)) {
      throw new StorageKeyError(`a receipt has no public URL: ${key}`);
    }
    return `/${key}`;
  },
};

/** The bytes of one file under the root, or `null` when there is none. */
const readUnderRoot = async (relative: string): Promise<Buffer | null> => {
  const file = resolveUnderRoot(relative);
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

/**
 * Read one stored upload by the filename the serving route captured (the part
 * after `/uploads/`), or `null` when there is no such file. The route validates
 * the filename shape before calling; this re-asserts the resolved path stays in
 * the root regardless, so a traversal segment throws instead of reading.
 */
export const readLocalUpload = (filename: string): Promise<Buffer | null> =>
  readUnderRoot(filename);
