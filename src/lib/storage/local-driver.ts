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
import { UPLOAD_KEY_PREFIX } from './image-upload';
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
 * The filename half of an uploads key, or a refusal. Keys the driver stores and
 * deletes must live under the `uploads/` namespace — a seed product's
 * `products/…` key (served from `public/`, never through this driver) is
 * rejected, so a "change image" on a bundled product can never delete a
 * committed asset.
 */
const filenameFromKey = (key: string): string => {
  const prefix = `${UPLOAD_KEY_PREFIX}/`;
  if (!key.startsWith(prefix)) {
    throw new StorageKeyError(`not an uploads key: ${key}`);
  }
  return key.slice(prefix.length);
};

export const localDriver: StorageDriver = {
  // `contentType` is unused here: the extension we chose from the sniffed type
  // is authoritative, and the serving route derives the response type from it.
  // The S3 driver will send it on the PUT — the parameter is the seam's, not
  // this implementation's.
  async put(key, data) {
    const file = resolveUnderRoot(filenameFromKey(key));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  },

  async delete(key) {
    const file = resolveUnderRoot(filenameFromKey(key));
    try {
      await unlink(file);
    } catch (error) {
      // Already gone is success — deletes are idempotent (a retried cleanup, a
      // row whose file was pruned). Anything else is a real failure.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  },
};

/**
 * Read one stored upload by the filename the serving route captured (the part
 * after `/uploads/`), or `null` when there is no such file. The route validates
 * the filename shape before calling; this re-asserts the resolved path stays in
 * the root regardless, so a traversal segment throws instead of reading.
 */
export const readLocalUpload = async (
  filename: string,
): Promise<Buffer | null> => {
  const file = resolveUnderRoot(filename);
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};
