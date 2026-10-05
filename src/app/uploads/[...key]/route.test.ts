// The serving route is the read half of the local storage driver and a trust
// boundary in its own right — as dangerous as the write path. Its two defences
// (the filename-shape regex, then the driver's root re-assertion) are each unit
// tested elsewhere; this exercises the route handler that wires them together —
// `key.join('/')` → gate → content-type → read — end to end, which nothing else
// does. A traversal must be a 404 that never reads a byte off disk; a real key
// must serve the bytes with a whitelisted, non-sniffable content type.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VARS } from '@/lib/utils/env';
import { GET } from './route';

// The route reads the root from the env at call time (like the driver), so a
// throwaway root per test is all the isolation it needs — no module reload.
let root: string;
const original = process.env[VARS.APP_CONFIG_STORAGE_LOCAL_ROOT];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'smokey-serve-'));
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

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/** Invoke the handler the way Next does: a Request plus the awaited params. */
const serve = (key: string[]) =>
  GET(new Request('http://localhost/uploads'), {
    params: Promise.resolve({ key }),
  });

describe('GET /uploads/[...key]', () => {
  it('serves a stored image with a whitelisted, non-sniffable content type', async () => {
    await writeFile(path.join(root, `${UUID}.jpg`), JPEG);

    const res = await serve([`${UUID}.jpg`]);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
  });

  it('derives the content type from the extension, not a guess', async () => {
    await writeFile(path.join(root, `${UUID}.png`), JPEG);
    const res = await serve([`${UUID}.png`]);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('404s a well-formed key with no file behind it', async () => {
    expect((await serve([`${UUID}.webp`])).status).toBe(404);
  });

  it('never serves a receipt, though its file is right there under the root', async () => {
    // Receipts share the local root (a `receipts/` folder beside the uploads);
    // the public route must not be a second way in.
    await mkdir(path.join(root, 'receipts'));
    await writeFile(path.join(root, 'receipts', `${UUID}.jpg`), JPEG);

    const res = await serve(['receipts', `${UUID}.jpg`]);

    expect(res.status).toBe(404);
    expect(new Uint8Array(await res.arrayBuffer())).not.toEqual(JPEG);
  });

  // The point of the suite: every traversal shape is a 404 at the gate, before
  // the filesystem is touched — and cannot reach a file that exists outside the
  // root. A secret planted one level up (a sibling of the root) stands in for
  // "anything outside the storage directory".
  describe('path traversal', () => {
    it('never reads a file outside the storage root, whatever the shape', async () => {
      // Two sibling secrets one level up: one with a rejected extension (the
      // content-type whitelist would stop it) and one that *ends in an accepted
      // .jpg* — the case where the filename-shape gate is the only thing between
      // the request and a file outside the root. Remove that gate and the .jpg
      // escape stops being a 404 (the driver's root assertion turns it into a
      // throw instead), which is what makes this pin fail on a reverted gate.
      const secret = 'top secret';
      const secrets = ['serve-secret.txt', 'serve-secret.jpg'].map((name) =>
        path.join(path.dirname(root), name),
      );
      await Promise.all(secrets.map((p) => writeFile(p, secret)));
      try {
        const escapes: string[][] = [
          ['..', 'serve-secret.jpg'], // ../serve-secret.jpg — accepted extension
          ['..', 'serve-secret.txt'], // ../serve-secret.txt
          ['..', '..', 'etc', 'passwd'], // ../../etc/passwd
          ['', 'etc', 'passwd'], // /etc/passwd (absolute)
          [`${UUID}.jpg`, 'x'], // a subpath — join reintroduces a slash
          [`${UUID}.svg`], // a shape-valid name with an unaccepted extension
          [`${UUID}.jpg${String.fromCharCode(0)}`], // NUL-suffixed name
          ['.env'], // a dotfile
        ];

        for (const key of escapes) {
          const res = await serve(key);
          expect(res.status).toBe(404);
          // Not merely "not 200": prove the secret's bytes never came back.
          expect(await res.text()).not.toContain(secret);
        }
      } finally {
        await Promise.all(secrets.map((p) => rm(p, { force: true })));
      }
    });
  });
});
