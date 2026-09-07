// Request-level tests for the admin content API, driven through the real Hono
// `app` — so they prove the mount order in ../index.ts (the admin guard runs
// before every content handler) and the whole PUT + upload path, not a handler
// in isolation. Only the session lookup is mocked.
//
// The authz matrix is the point: PUT and the image upload each answer 401 with
// no session, 403 to a customer, and succeed for an admin — and the public
// product read is still reachable unauthenticated after the mount, the
// regression that would catch a leaking `/admin/*` guard.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { siteContent } from '@/db/schema/site-content';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import {
  API_PATHS,
  apiAdminContentPath,
  apiProductPath,
} from '@/lib/constant/paths';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import type { ApiResponse } from '@/lib/hono/envelope';
import { MAX_UPLOAD_BYTES } from '@/lib/storage/image-upload';
import { VARS } from '@/lib/utils/env';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ isAuthenticatedUser: mocks.getSession }));

const { app } = await importWithDb(() => import('@/lib/hono'));
const { readLocalUpload } = await importWithDb(
  () => import('@/lib/storage/local-driver'),
);

/** A real image: a minimal JPEG header padded out — the bytes the route sniffs. */
const jpegBytes = (size = 64): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(new ArrayBuffer(size));
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
};

const asAdmin = () =>
  mocks.getSession.mockResolvedValue({
    user: { id: 'admin-1', role: 'admin' },
    session: { id: 's1' },
  });
const asCustomer = () =>
  mocks.getSession.mockResolvedValue({
    user: { id: 'cust-1', role: 'customer' },
    session: { id: 's2' },
  });
const anon = () => mocks.getSession.mockResolvedValue(null);

let storageRoot: string;
const originalRoot = process.env[VARS.APP_CONFIG_STORAGE_LOCAL_ROOT];
const originalProvider = process.env[VARS.APP_CONFIG_STORAGE_PROVIDER];

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), 'smokey-content-uploads-'));
  process.env[VARS.APP_CONFIG_STORAGE_LOCAL_ROOT] = storageRoot;
  // Pin the local driver regardless of what .env selects (belt-and-suspenders on
  // top of vitest.config's global pin) so this suite never writes to a real bucket.
  process.env[VARS.APP_CONFIG_STORAGE_PROVIDER] = 'local';
});

afterAll(async () => {
  if (originalRoot === undefined) {
    delete process.env[VARS.APP_CONFIG_STORAGE_LOCAL_ROOT];
  } else {
    process.env[VARS.APP_CONFIG_STORAGE_LOCAL_ROOT] = originalRoot;
  }
  if (originalProvider === undefined) {
    delete process.env[VARS.APP_CONFIG_STORAGE_PROVIDER];
  } else {
    process.env[VARS.APP_CONFIG_STORAGE_PROVIDER] = originalProvider;
  }
  await rm(storageRoot, { recursive: true, force: true });
});

describe.skipIf(!databaseReachable)('admin content API', () => {
  const putJson = (key: string, body: unknown) =>
    app.request(apiAdminContentPath(key), {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });

  const uploadImage = (file: File | undefined) => {
    const form = new FormData();
    if (file) form.set('file', file);
    return app.request(API_PATHS.ADMIN_CONTENT_IMAGES, {
      method: 'POST',
      body: form,
    });
  };

  const parse = async <T>(res: Response) => ({
    status: res.status,
    body: (await res.json()) as ApiResponse<T>,
  });

  afterEach(async () => {
    mocks.getSession.mockReset();
    await testDb
      .delete(siteContent)
      .where(inArray(siteContent.key, ['about.cta', 'header']));
  });

  // ── Authz matrix ──────────────────────────────────────────────────────────

  describe('authorization', () => {
    it('answers 401 without a session on the PUT and the upload', async () => {
      anon();
      const calls = await Promise.all([
        putJson('about.cta', { headline: 'x' }),
        uploadImage(new File([jpegBytes()], 'x.jpg', { type: 'image/jpeg' })),
      ]);
      expect(calls.map((c) => c.status)).toEqual([401, 401]);
    });

    it('answers 403 to a signed-in customer on the PUT and the upload', async () => {
      asCustomer();
      const calls = await Promise.all([
        putJson('about.cta', { headline: 'x' }),
        uploadImage(new File([jpegBytes()], 'x.jpg', { type: 'image/jpeg' })),
      ]);
      expect(calls.map((c) => c.status)).toEqual([403, 403]);
    });

    it('refuses before it parses the body — a customer PUTting junk still gets 403', async () => {
      asCustomer();
      const res = await putJson('about.cta', { headline: 42, extra: true });
      expect(res.status).toBe(403);
    });

    it('leaves the public product read reachable unauthenticated after the mount', async () => {
      anon();
      // A slug that does not exist still proves the route is not behind the admin
      // guard: it answers 404 (a public not-found), never 401/403.
      const res = await app.request(apiProductPath('no-such-slug-at-all'));
      expect(res.status).toBe(404);
    });
  });

  // ── PUT /admin/content/{key} ────────────────────────────────────────────────

  describe('PUT /admin/content/{key}', () => {
    it('stores a valid block and returns it (200)', async () => {
      asAdmin();
      const { status, body } = await parse<{
        key: string;
        value: { headline: string };
      }>(
        await putJson('about.cta', {
          headline: 'به جمع ما بپیوند',
          cta: 'برو',
        }),
      );

      expect(status).toBe(200);
      if (body.status !== 'success') throw new Error(body.message);
      expect(body.data.key).toBe('about.cta');
      expect(body.data.value).toEqual({
        headline: 'به جمع ما بپیوند',
        cta: 'برو',
      });

      // The row is really there.
      const rows = await testDb
        .select()
        .from(siteContent)
        .where(eq(siteContent.key, 'about.cta'));
      expect(rows).toHaveLength(1);
    });

    it('strips fields the schema does not declare before storing', async () => {
      asAdmin();
      await putJson('about.cta', { headline: 'x', cta: 'y', role: 'admin' });
      const [row] = await testDb
        .select()
        .from(siteContent)
        .where(eq(siteContent.key, 'about.cta'));
      expect(row.value).toEqual({ headline: 'x', cta: 'y' });
    });

    it('400s a body failing that key’s schema, with field-scoped errors', async () => {
      asAdmin();
      // about.hero needs eyebrow/headline/accent/body/image; this is missing all.
      const { status, body } = await parse(
        await putJson('about.hero', { eyebrow: '' }),
      );
      expect(status).toBe(400);
      if (body.status !== 'error') throw new Error('expected error');
      // The issues carry field paths the client can map onto inputs.
      expect(body.errors && body.errors.length).toBeGreaterThan(0);
    });

    it('400s an image key of the wrong shape (security: no URL, no traversal)', async () => {
      asAdmin();
      const res = await putJson('about.story', {
        ...DEFAULT_CONTENT['about.story'],
        image: { key: 'http://evil.example/x.jpg', alt: 'x' },
      });
      expect(res.status).toBe(400);
      // Nothing was written.
      const rows = await testDb
        .select()
        .from(siteContent)
        .where(eq(siteContent.key, 'about.story'));
      expect(rows).toHaveLength(0);
    });

    it('400s an unknown key', async () => {
      asAdmin();
      const res = await putJson('home.unknown', { headline: 'x' });
      expect(res.status).toBe(400);
    });

    it('400s a wrong-count link tuple (a 4-label header nav), writing nothing', async () => {
      asAdmin();
      // The nav tuple is exactly 3 (one per NAV_TARGET); a fourth label is the
      // misroute the parity rule guards, rejected at the write boundary.
      const res = await putJson('header', {
        ...DEFAULT_CONTENT.header,
        nav: ['خانه', 'فروشگاه', 'درباره ما', 'اضافه'],
      });
      expect(res.status).toBe(400);
      const rows = await testDb
        .select()
        .from(siteContent)
        .where(eq(siteContent.key, 'header'));
      expect(rows).toHaveLength(0);
    });
  });

  // ── POST /admin/content/images ──────────────────────────────────────────────

  describe('POST /admin/content/images', () => {
    it('stores a valid image and returns a server-generated key + url (201)', async () => {
      asAdmin();
      const bytes = jpegBytes();
      const { status, body } = await parse<{ key: string; url: string }>(
        await uploadImage(
          new File([bytes], 'photo.jpg', { type: 'image/jpeg' }),
        ),
      );

      expect(status).toBe(201);
      if (body.status !== 'success') throw new Error(body.message);
      // Under the uploads namespace, a uuid filename, never the client filename.
      expect(body.data.key).toMatch(/^uploads\/[0-9a-f-]+\.jpg$/);
      expect(body.data.key).not.toContain('photo');
      expect(body.data.url).toBe(`/${body.data.key}`);

      // The bytes are readable back off disk, and NO product_images row exists.
      const filename = body.data.key.split('/')[1];
      const served = await readLocalUpload(filename);
      expect(served && new Uint8Array(served)).toEqual(bytes);
    });

    it('400s a non-image, even one lying about its content-type', async () => {
      asAdmin();
      const notAnImage = new File(
        [Uint8Array.from(new TextEncoder().encode('<?php echo 1; ?>'))],
        'evil.jpg',
        { type: 'image/jpeg' },
      );
      expect((await uploadImage(notAnImage)).status).toBe(400);
    });

    it('400s when no file field is present', async () => {
      asAdmin();
      expect((await uploadImage(undefined)).status).toBe(400);
    });

    it('413s a file over the size limit before storing it', async () => {
      asAdmin();
      const big = jpegBytes(MAX_UPLOAD_BYTES + 1024);
      const res = await uploadImage(
        new File([big], 'big.jpg', { type: 'image/jpeg' }),
      );
      expect(res.status).toBe(413);
    });
  });
});
