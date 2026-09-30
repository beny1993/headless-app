import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VARS } from '@/lib/utils/env';
import {
  localDriver,
  localStorageRoot,
  readLocalUpload,
  StorageKeyError,
} from './local-driver';

// Point the driver at a throwaway root per test. Env is read at call time, so
// setting the var is all it takes — no module reload.
let root: string;
const original = process.env[VARS.APP_CONFIG_STORAGE_LOCAL_ROOT];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'smokey-storage-'));
  process.env[VARS.APP_CONFIG_STORAGE_LOCAL_ROOT] = root;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

afterAll(() => {
  if (original === undefined)
    delete process.env[VARS.APP_CONFIG_STORAGE_LOCAL_ROOT];
  else process.env[VARS.APP_CONFIG_STORAGE_LOCAL_ROOT] = original;
});

const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe('localDriver', () => {
  it('writes a key under the root and reads the same bytes back', async () => {
    const key = 'uploads/123e4567-e89b-12d3-a456-426614174000.jpg';
    await localDriver.put(key, bytes, 'image/jpeg');

    // Physically under the configured root, named by the filename half only.
    const onDisk = await readFile(
      path.join(root, '123e4567-e89b-12d3-a456-426614174000.jpg'),
    );
    expect(new Uint8Array(onDisk)).toEqual(bytes);

    const served = await readLocalUpload(
      '123e4567-e89b-12d3-a456-426614174000.jpg',
    );
    expect(served && new Uint8Array(served)).toEqual(bytes);
  });

  it('resolves url(key) to the root-relative /uploads path', () => {
    expect(localDriver.url('uploads/abc.png')).toBe('/uploads/abc.png');
  });

  it('deletes a stored key, and treats a missing key as already gone', async () => {
    const key = 'uploads/123e4567-e89b-12d3-a456-426614174000.png';
    await localDriver.put(key, bytes, 'image/png');
    await localDriver.delete(key);
    expect(
      await readLocalUpload('123e4567-e89b-12d3-a456-426614174000.png'),
    ).toBe(null);
    // A second delete must not throw — deletes are idempotent.
    await expect(localDriver.delete(key)).resolves.toBeUndefined();
  });

  it('refuses to write or delete a key outside the uploads namespace', async () => {
    // A seed product's key lives under public/products — the local driver must
    // never reach it, so "change image" can never clobber a bundled asset.
    await expect(
      localDriver.put('products/cat-dry-food.jpg', bytes, 'image/jpeg'),
    ).rejects.toBeInstanceOf(StorageKeyError);
    await expect(
      localDriver.delete('products/cat-dry-food.jpg'),
    ).rejects.toBeInstanceOf(StorageKeyError);
  });

  it('refuses a traversal key that would escape the root', async () => {
    await expect(
      localDriver.put('uploads/../../etc/passwd', bytes, 'image/jpeg'),
    ).rejects.toBeInstanceOf(StorageKeyError);
  });

  it('refuses to serve a traversal filename, and returns null for a miss', async () => {
    await expect(readLocalUpload('../../etc/passwd')).rejects.toBeInstanceOf(
      StorageKeyError,
    );
    // A well-formed but absent file is a miss, not an error (route → 404).
    expect(await readLocalUpload('does-not-exist.jpg')).toBe(null);
  });

  it('does not serve a file that exists outside the root via a crafted name', async () => {
    // Plant a secret next to (not inside) the root and try to reach it.
    const secret = path.join(path.dirname(root), 'secret.txt');
    await writeFile(secret, 'top secret');
    await expect(
      readLocalUpload(`..${path.sep}${path.basename(secret)}`),
    ).rejects.toBeInstanceOf(StorageKeyError);
    await rm(secret, { force: true });
  });

  it('resolves the root from the env var, per call', () => {
    expect(localStorageRoot()).toBe(path.resolve(root));
  });

  describe('receipts', () => {
    const RECEIPT = 'receipts/123e4567-e89b-12d3-a456-426614174000.jpg';

    it('keeps a receipt in a receipts/ folder beside the uploads, and reads it back', async () => {
      await localDriver.put(RECEIPT, bytes, 'image/jpeg');

      const onDisk = await readFile(
        path.join(root, 'receipts', '123e4567-e89b-12d3-a456-426614174000.jpg'),
      );
      expect(new Uint8Array(onDisk)).toEqual(bytes);
      expect(await localDriver.get(RECEIPT)).toEqual(bytes);
    });

    it('answers null for a receipt that is not there', async () => {
      expect(await localDriver.get(RECEIPT)).toBe(null);
    });

    it('deletes a receipt', async () => {
      await localDriver.put(RECEIPT, bytes, 'image/jpeg');
      await localDriver.delete(RECEIPT);
      expect(await localDriver.get(RECEIPT)).toBe(null);
    });

    it('has no URL for a receipt — only the authenticated routes read one', () => {
      // A root-relative path would render as a broken public URL; a throw is
      // a bug somebody sees.
      expect(() => localDriver.url(RECEIPT)).toThrow(StorageKeyError);
    });

    it('refuses a receipt key that is not one flat name', async () => {
      // `receipts/../x.jpg` resolves inside the root — straight into the public
      // uploads folder — so the root check alone would let it through.
      for (const bad of [
        'receipts/../123e4567-e89b-12d3-a456-426614174000.jpg',
        'receipts/nested/123e4567-e89b-12d3-a456-426614174000.jpg',
        'receipts/..',
      ]) {
        await expect(
          localDriver.put(bad, bytes, 'image/jpeg'),
        ).rejects.toBeInstanceOf(StorageKeyError);
        await expect(localDriver.get(bad)).rejects.toBeInstanceOf(
          StorageKeyError,
        );
      }
      expect(await readdir(root)).toEqual([]);
    });
  });

  it('reads an upload back through get', async () => {
    const key = 'uploads/123e4567-e89b-12d3-a456-426614174000.png';
    await localDriver.put(key, bytes, 'image/png');
    expect(await localDriver.get(key)).toEqual(bytes);
  });
});
