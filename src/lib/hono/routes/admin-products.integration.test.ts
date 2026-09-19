// Request-level tests for the admin product API, driven through the real Hono
// `app` — so what they prove is the mount order in ../index.ts (the guard runs
// before every admin handler) and the whole create/update/delete/upload path,
// not just a handler in isolation. Only the session lookup is mocked.
//
// The authz matrix is the point: every admin route answers 401 with no session,
// 403 to a customer, and succeeds for an admin — and the public product read is
// still reachable unauthenticated after the admin router is mounted, the
// regression that would catch a leaking `/admin/*` guard.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { faker } from '@faker-js/faker';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  categories,
  PET_TYPES,
  productImages,
  products,
  type Category,
} from '@/db/schema/catalog';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import {
  API_PATHS,
  apiAdminProductImagesPath,
  apiAdminProductPath,
  apiProductPath,
} from '@/lib/constant/paths';
import { PRODUCT_MESSAGES } from '@/lib/catalog/product-input';
import { VARIANT_MESSAGES, hasMembersMessage } from '@/lib/catalog/variant';
import { SKU_ALPHABET, SKU_SUFFIX_LENGTH } from '@/lib/catalog/sku';
import type { ApiResponse } from '@/lib/hono/envelope';
import { MAX_UPLOAD_BYTES } from '@/lib/storage/image-upload';
import { VARS } from '@/lib/utils/env';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ isAuthenticatedUser: mocks.getSession }));

const { app } = await importWithDb(() => import('@/lib/hono'));
const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));
const { readLocalUpload } = await importWithDb(
  () => import('@/lib/storage/local-driver'),
);

// A real image: a minimal JPEG header padded out. Bytes are what the route
// sniffs, so the header is what matters, not the payload. Backed by an explicit
// ArrayBuffer so the array is a `Uint8Array<ArrayBuffer>` — a valid `BlobPart`
// under TS's typed-array generics, unlike the `ArrayBufferLike` a bare
// `new Uint8Array(n)` infers.
const jpegBytes = (size = 64): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(new ArrayBuffer(size));
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
};

const asAdmin = () =>
  mocks.getSession.mockResolvedValue({
    user: { id: 'admin-1', email: 'a@example.com', role: 'admin' },
    session: { id: 's1' },
  });
const asCustomer = () =>
  mocks.getSession.mockResolvedValue({
    user: { id: 'cust-1', email: 'c@example.com', role: 'customer' },
    session: { id: 's2' },
  });
const anon = () => mocks.getSession.mockResolvedValue(null);

let storageRoot: string;
const originalRoot = process.env[VARS.APP_CONFIG_STORAGE_LOCAL_ROOT];
const originalProvider = process.env[VARS.APP_CONFIG_STORAGE_PROVIDER];

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), 'smokey-admin-uploads-'));
  process.env[VARS.APP_CONFIG_STORAGE_LOCAL_ROOT] = storageRoot;
  // Pin the local driver regardless of what .env selects: this suite uploads
  // through the real route and reads the bytes back off disk. With a real .env
  // set to `s3` it would otherwise push to the live bucket during `pnpm test`
  // (and the `url === /${key}` assertion below would break).
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

describe.skipIf(!databaseReachable)('admin product API', () => {
  const createdCategoryIds: string[] = [];

  const makeCategory = async (): Promise<Category> => {
    const [row] = await testDb
      .insert(categories)
      .values({
        title: 'دسته آزمایشی',
        slug: `admin-${faker.string.alphanumeric(10).toLowerCase()}`,
      })
      .returning();
    createdCategoryIds.push(row.id);
    return row;
  };

  const body = (category: Category, over: Record<string, unknown> = {}) => {
    const token = faker.string.alphanumeric(8).toLowerCase();
    return {
      title: 'غذای خشک گربه',
      slug: `p-${token}`,
      sku: `SKU-${token.toUpperCase()}`,
      brand: 'رویال کنین',
      description: 'توضیح کامل.',
      benefit: 'مناسب گوارش حساس',
      price: 2_450_000,
      oldPrice: 2_900_000,
      stock: 12,
      categoryId: category.id,
      petTypes: [PET_TYPES.CAT],
      isActive: true,
      ...over,
    };
  };

  const json = (path: string, method: string, b?: unknown) =>
    app.request(path, {
      method,
      ...(b === undefined
        ? {}
        : {
            body: JSON.stringify(b),
            headers: { 'content-type': 'application/json' },
          }),
    });

  const parse = async <T>(res: Response) => ({
    status: res.status,
    body: (await res.json()) as ApiResponse<T>,
  });

  afterEach(async () => {
    mocks.getSession.mockReset();
    if (createdCategoryIds.length > 0) {
      // Members first: `variant_of` restricts, so a head cannot go while one of
      // its members still points at it.
      await testDb
        .delete(products)
        .where(
          and(
            inArray(products.categoryId, createdCategoryIds),
            isNotNull(products.variantOf),
          ),
        );
      await testDb
        .delete(products)
        .where(inArray(products.categoryId, createdCategoryIds));
      await testDb
        .delete(categories)
        .where(inArray(categories.id, createdCategoryIds));
      createdCategoryIds.length = 0;
    }
  });

  // ── Authz matrix ──────────────────────────────────────────────────────────

  describe('authorization', () => {
    it('answers 401 without a session on every admin route', async () => {
      anon();
      const someId = faker.string.uuid();
      const calls = await Promise.all([
        json(API_PATHS.ADMIN_PRODUCTS, 'POST', {}),
        json(apiAdminProductPath(someId), 'PUT', {}),
        json(apiAdminProductPath(someId), 'DELETE'),
        app.request(apiAdminProductImagesPath(someId), { method: 'POST' }),
      ]);
      expect(calls.map((c) => c.status)).toEqual([401, 401, 401, 401]);
    });

    it('answers 403 to a signed-in customer on every admin route', async () => {
      asCustomer();
      const someId = faker.string.uuid();
      const calls = await Promise.all([
        json(API_PATHS.ADMIN_PRODUCTS, 'POST', {}),
        json(apiAdminProductPath(someId), 'PUT', {}),
        json(apiAdminProductPath(someId), 'DELETE'),
        app.request(apiAdminProductImagesPath(someId), { method: 'POST' }),
      ]);
      expect(calls.map((c) => c.status)).toEqual([403, 403, 403, 403]);
    });

    it('refuses before it parses the body — a customer POSTing junk still gets 403', async () => {
      // The guard runs first: an invalid body from a customer is 403, not the
      // 400 the validator would give, proving authorize-before-parse.
      asCustomer();
      const res = await json(API_PATHS.ADMIN_PRODUCTS, 'POST', {
        price: 'not-a-number',
      });
      expect(res.status).toBe(403);
    });

    it('leaves the public product read reachable unauthenticated', async () => {
      // The regression for a leaking `/admin/*` guard: mounting the admin router
      // must not put the public catalog behind auth.
      const category = await makeCategory();
      asAdmin();
      const created = await parse<{ slug: string }>(
        await json(API_PATHS.ADMIN_PRODUCTS, 'POST', body(category)),
      );
      if (created.body.status !== 'success') throw new Error('setup failed');

      anon();
      const res = await app.request(apiProductPath(created.body.data.slug));
      expect(res.status).toBe(200);
    });
  });

  // ── Create ──────────────────────────────────────────────────────────────────

  describe('POST /admin/products', () => {
    it('creates a product and returns it (201)', async () => {
      const category = await makeCategory();
      asAdmin();
      const { status, body: envelope } = await parse<{
        id: string;
        isActive: boolean;
        price: number;
      }>(await json(API_PATHS.ADMIN_PRODUCTS, 'POST', body(category)));

      expect(status).toBe(201);
      if (envelope.status !== 'success') throw new Error(envelope.message);
      expect(envelope.data.price).toBe(2_450_000);
      expect(envelope.data.isActive).toBe(true);

      const inDb = await testDb
        .select()
        .from(products)
        .where(eq(products.id, envelope.data.id));
      expect(inDb).toHaveLength(1);
    });

    it('400s a duplicate slug with a field-scoped error', async () => {
      const category = await makeCategory();
      asAdmin();
      const first = body(category);
      await json(API_PATHS.ADMIN_PRODUCTS, 'POST', first);
      const { status, body: envelope } = await parse(
        await json(API_PATHS.ADMIN_PRODUCTS, 'POST', {
          ...body(category),
          slug: first.slug,
        }),
      );
      expect(status).toBe(400);
      if (envelope.status !== 'error') throw new Error('expected error');
      expect(envelope.errors?.some((e) => e.startsWith('slug:'))).toBe(true);
    });

    it('400s an invalid body (zero price) from the validator', async () => {
      const category = await makeCategory();
      asAdmin();
      const res = await json(API_PATHS.ADMIN_PRODUCTS, 'POST', {
        ...body(category),
        price: 0,
      });
      expect(res.status).toBe(400);
    });

    it('400s an unknown category (FK) rather than 500', async () => {
      asAdmin();
      const category = await makeCategory();
      const res = await parse(
        await json(API_PATHS.ADMIN_PRODUCTS, 'POST', {
          ...body(category),
          categoryId: faker.string.uuid(),
        }),
      );
      expect(res.status).toBe(400);
      if (res.body.status !== 'error') throw new Error('expected error');
      expect(res.body.errors?.some((e) => e.startsWith('categoryId:'))).toBe(
        true,
      );
    });

    it('stores both pets and answers with them in order', async () => {
      const category = await makeCategory();
      asAdmin();
      const { status, body: envelope } = await parse<{ petTypes: string[] }>(
        await json(
          API_PATHS.ADMIN_PRODUCTS,
          'POST',
          body(category, { petTypes: [PET_TYPES.DOG, PET_TYPES.CAT] }),
        ),
      );
      expect(status).toBe(201);
      if (envelope.status !== 'success') throw new Error(envelope.message);
      expect(envelope.data.petTypes).toEqual(['cat', 'dog']);
    });

    it('400s an empty pet selection with the message the form shows', async () => {
      const category = await makeCategory();
      asAdmin();
      const res = await parse(
        await json(
          API_PATHS.ADMIN_PRODUCTS,
          'POST',
          body(category, { petTypes: [] }),
        ),
      );
      expect(res.status).toBe(400);
      if (res.body.status !== 'error') throw new Error('expected error');
      // Keyed on the bare field name, or the form has no field to show it on.
      expect(res.body.errors).toContain(
        `petTypes: ${PRODUCT_MESSAGES.petRequired}`,
      );
    });

    it('round-trips the additional categories, keeping categoryId the main one', async () => {
      const primary = await makeCategory();
      const extra = await makeCategory();
      asAdmin();
      const { status, body: envelope } = await parse<{
        id: string;
        categoryId: string;
        extraCategoryIds: string[];
      }>(
        await json(
          API_PATHS.ADMIN_PRODUCTS,
          'POST',
          body(primary, { extraCategoryIds: [extra.id] }),
        ),
      );

      expect(status).toBe(201);
      if (envelope.status !== 'success') throw new Error(envelope.message);
      expect(envelope.data).toMatchObject({
        categoryId: primary.id,
        extraCategoryIds: [extra.id],
      });
    });

    it('accepts a body with no additional categories at all', async () => {
      // The field is absent from `body()`, which is the point: every body
      // written before this story stays valid and means «none».
      const category = await makeCategory();
      asAdmin();
      const { status, body: envelope } = await parse<{
        extraCategoryIds: string[];
      }>(await json(API_PATHS.ADMIN_PRODUCTS, 'POST', body(category)));

      expect(status).toBe(201);
      if (envelope.status !== 'success') throw new Error(envelope.message);
      expect(envelope.data.extraCategoryIds).toEqual([]);
    });

    it('400s an unknown additional category, leaving no product behind', async () => {
      const category = await makeCategory();
      const sent = body(category, { extraCategoryIds: [faker.string.uuid()] });
      asAdmin();

      const res = await parse(
        await json(API_PATHS.ADMIN_PRODUCTS, 'POST', sent),
      );

      expect(res.status).toBe(400);
      if (res.body.status !== 'error') throw new Error('expected error');
      expect(res.body.errors).toContain(
        `extraCategoryIds: ${PRODUCT_MESSAGES.extraCategories}`,
      );
      // The junction write and the product row are one transaction.
      const left = await testDb
        .select({ id: products.id })
        .from(products)
        .where(eq(products.slug, sent.slug as string));
      expect(left).toEqual([]);
    });

    it('keys a malformed additional id on the bare field, not on its index', async () => {
      // `formatZodIssues` would emit `extraCategoryIds.1` for an array element
      // — an error key no field on the form ever looks up.
      const category = await makeCategory();
      asAdmin();

      const res = await parse(
        await json(
          API_PATHS.ADMIN_PRODUCTS,
          'POST',
          body(category, {
            extraCategoryIds: [faker.string.uuid(), 'not-a-uuid'],
          }),
        ),
      );

      expect(res.status).toBe(400);
      if (res.body.status !== 'error') throw new Error('expected error');
      expect(res.body.errors).toContain(
        `extraCategoryIds: ${PRODUCT_MESSAGES.extraCategories}`,
      );
    });

    it('keys a bad pet value on the bare field, not on its index', async () => {
      // Same trap as the additional ids above: `petTypes.0` is a key the
      // form's pet fieldset never reads, so the refusal would be invisible.
      const category = await makeCategory();
      asAdmin();

      const res = await parse(
        await json(
          API_PATHS.ADMIN_PRODUCTS,
          'POST',
          body(category, { petTypes: [PET_TYPES.CAT, 'hamster'] }),
        ),
      );

      expect(res.status).toBe(400);
      if (res.body.status !== 'error') throw new Error('expected error');
      expect(res.body.errors).toContain(`petTypes: ${PRODUCT_MESSAGES.pet}`);
    });

    it('400s a NUL byte in the title rather than a database 500', async () => {
      const category = await makeCategory();
      asAdmin();
      const res = await parse(
        await json(
          API_PATHS.ADMIN_PRODUCTS,
          'POST',
          body(category, { title: `غذای گربه${String.fromCharCode(0)}` }),
        ),
      );
      expect(res.status).toBe(400);
      if (res.body.status !== 'error') throw new Error('expected error');
      expect(res.body.errors).toContain(`title: ${PRODUCT_MESSAGES.textChars}`);
    });
  });

  // ── SKU generation ────────────────────────────────────────────────────────

  describe('SKU generation', () => {
    const skuPattern = (slug: string) =>
      new RegExp(
        `^${slug.toUpperCase()}-[${SKU_ALPHABET}]{${SKU_SUFFIX_LENGTH}}$`,
      );

    it('derives the SKU from the slug and ignores one the client sends', async () => {
      const category = await makeCategory();
      asAdmin();
      const sent = body(category, { sku: 'CLIENT-CHOSEN' });
      const res = await parse<{ id: string; sku: string }>(
        await json(API_PATHS.ADMIN_PRODUCTS, 'POST', sent),
      );
      expect(res.status).toBe(201);
      if (res.body.status !== 'success') throw new Error(res.body.message);
      expect(res.body.data.sku).toMatch(skuPattern(sent.slug));
      const [stored] = await testDb
        .select()
        .from(products)
        .where(eq(products.id, res.body.data.id));
      expect(stored.sku).toBe(res.body.data.sku);
    });

    it('never changes the SKU on update, even when the slug is renamed', async () => {
      const category = await makeCategory();
      asAdmin();
      const created = await parse<{ id: string; sku: string }>(
        await json(API_PATHS.ADMIN_PRODUCTS, 'POST', body(category)),
      );
      if (created.body.status !== 'success')
        throw new Error(created.body.message);
      const renamed = `r-${faker.string.alphanumeric(8).toLowerCase()}`;
      const res = await parse<{ slug: string; sku: string }>(
        await json(apiAdminProductPath(created.body.data.id), 'PUT', {
          ...body(category),
          slug: renamed,
          sku: 'CLIENT-CHOSEN',
          expectedStock: 12,
        }),
      );
      expect(res.status).toBe(200);
      if (res.body.status !== 'success') throw new Error(res.body.message);
      expect(res.body.data.slug).toBe(renamed);
      expect(res.body.data.sku).toBe(created.body.data.sku);
    });
  });

  // ── Update ────────────────────────────────────────────────────────────────

  describe('PUT /admin/products/{id}', () => {
    it('replaces the product and returns it (200)', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create({
        title: 'قدیمی',
        slug: `u-${faker.string.alphanumeric(8).toLowerCase()}`,
        sku: `U-${faker.string.alphanumeric(8).toUpperCase()}`,
        price: 100_000,
        stock: 3,
        categoryId: category.id,
        petTypes: [PET_TYPES.CAT],
      });
      asAdmin();
      const { status, body: envelope } = await parse<{
        title: string;
        price: number;
      }>(
        await json(apiAdminProductPath(product.id), 'PUT', {
          ...body(category),
          expectedStock: 3,
          title: 'عنوان تازه',
          price: 555_000,
          oldPrice: null,
        }),
      );
      expect(status).toBe(200);
      if (envelope.status !== 'success') throw new Error(envelope.message);
      expect(envelope.data.title).toBe('عنوان تازه');
      expect(envelope.data.price).toBe(555_000);
    });

    it('replaces the additional categories, and clears them on an empty list', async () => {
      const primary = await makeCategory();
      const extra = await makeCategory();
      const token = faker.string.alphanumeric(8).toLowerCase();
      const product = await ProductDao.create({
        title: 'قدیمی',
        slug: `u-${token}`,
        sku: `U-${token.toUpperCase()}`,
        price: 100_000,
        stock: 3,
        categoryId: primary.id,
        petTypes: [PET_TYPES.CAT],
        extraCategoryIds: [extra.id],
      });
      asAdmin();
      const put = async (extraCategoryIds: string[]) =>
        parse<{ extraCategoryIds: string[] }>(
          await json(apiAdminProductPath(product.id), 'PUT', {
            ...body(primary),
            slug: product.slug,
            stock: 3,
            expectedStock: 3,
            extraCategoryIds,
          }),
        );

      const cleared = await put([]);
      if (cleared.body.status !== 'success')
        throw new Error(cleared.body.message);
      expect(cleared.body.data.extraCategoryIds).toEqual([]);

      const restored = await put([extra.id]);
      if (restored.body.status !== 'success')
        throw new Error(restored.body.message);
      expect(restored.body.data.extraCategoryIds).toEqual([extra.id]);
    });

    it('rejects a missing stock snapshot and reports stale stock changes as 409', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create(body(category));
      asAdmin();
      expect(
        (await json(apiAdminProductPath(product.id), 'PUT', body(category)))
          .status,
      ).toBe(400);
      await ProductDao.decrementStock(testDb, product.id, 1);
      const res = await json(apiAdminProductPath(product.id), 'PUT', {
        ...body(category),
        stock: 15,
        expectedStock: product.stock,
      });
      expect(res.status).toBe(409);
      const [stored] = await testDb
        .select()
        .from(products)
        .where(eq(products.id, product.id));
      expect(stored.stock).toBe(product.stock - 1);
    });

    it('404s an unknown id', async () => {
      const category = await makeCategory();
      asAdmin();
      const res = await json(apiAdminProductPath(faker.string.uuid()), 'PUT', {
        ...body(category),
        expectedStock: 0,
      });
      expect(res.status).toBe(404);
    });

    it('400s when oldPrice is not above price (cross-field rule)', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create({
        title: 'x',
        slug: `u2-${faker.string.alphanumeric(8).toLowerCase()}`,
        sku: `U2-${faker.string.alphanumeric(8).toUpperCase()}`,
        price: 100_000,
        stock: 3,
        categoryId: category.id,
        petTypes: [PET_TYPES.CAT],
      });
      asAdmin();
      const res = await json(apiAdminProductPath(product.id), 'PUT', {
        ...body(category),
        expectedStock: 3,
        price: 200_000,
        oldPrice: 150_000,
      });
      expect(res.status).toBe(400);
    });
  });

  // ── Soft delete ─────────────────────────────────────────────────────────────

  describe('DELETE /admin/products/{id}', () => {
    it('soft-deletes: keeps the row, hides it from the storefront, keeps it in admin', async () => {
      const category = await makeCategory();
      const product = await ProductDao.create({
        title: 'حذف‌شدنی',
        slug: `d-${faker.string.alphanumeric(8).toLowerCase()}`,
        sku: `D-${faker.string.alphanumeric(8).toUpperCase()}`,
        price: 100_000,
        stock: 3,
        categoryId: category.id,
        petTypes: [PET_TYPES.CAT],
      });
      asAdmin();
      const { status, body: envelope } = await parse<{ isActive: boolean }>(
        await json(apiAdminProductPath(product.id), 'DELETE'),
      );
      expect(status).toBe(200);
      if (envelope.status !== 'success') throw new Error(envelope.message);
      expect(envelope.data.isActive).toBe(false);

      // Row still there.
      const inDb = await testDb
        .select()
        .from(products)
        .where(eq(products.id, product.id));
      expect(inDb).toHaveLength(1);

      // Gone from the storefront read, still in the admin read.
      expect(await ProductDao.getBySlug(product.slug)).toBeNull();
      const admin = await ProductDao.listForAdmin({
        categorySlug: category.slug,
      });
      expect(admin.map((p) => p.id)).toContain(product.id);
    });

    it('404s an unknown id', async () => {
      asAdmin();
      const res = await json(
        apiAdminProductPath(faker.string.uuid()),
        'DELETE',
      );
      expect(res.status).toBe(404);
    });
  });

  // ── Image upload ──────────────────────────────────────────────────────────

  describe('POST /admin/products/{id}/images', () => {
    const upload = (id: string, file: File | undefined) => {
      const form = new FormData();
      if (file) form.set('file', file);
      return app.request(apiAdminProductImagesPath(id), {
        method: 'POST',
        body: form,
      });
    };

    const makeProduct = async (category: Category) =>
      ProductDao.create({
        title: 'با تصویر',
        slug: `img-${faker.string.alphanumeric(8).toLowerCase()}`,
        sku: `IMG-${faker.string.alphanumeric(8).toUpperCase()}`,
        price: 100_000,
        stock: 3,
        categoryId: category.id,
        petTypes: [PET_TYPES.CAT],
      });

    it('stores a valid image, records the key, and serves the bytes (201)', async () => {
      const category = await makeCategory();
      const product = await makeProduct(category);
      asAdmin();
      const bytes = jpegBytes();
      const { status, body: envelope } = await parse<{
        objectKey: string;
        url: string;
      }>(
        await upload(
          product.id,
          new File([bytes], 'photo.jpg', { type: 'image/jpeg' }),
        ),
      );

      expect(status).toBe(201);
      if (envelope.status !== 'success') throw new Error(envelope.message);
      // Server-generated key under the uploads namespace, not the client filename.
      expect(envelope.data.objectKey).toMatch(/^uploads\/[0-9a-f-]+\.jpg$/);
      expect(envelope.data.objectKey).not.toContain('photo');
      expect(envelope.data.url).toBe(`/${envelope.data.objectKey}`);

      // Row on product_images, and the file readable back.
      const rows = await testDb
        .select()
        .from(productImages)
        .where(eq(productImages.productId, product.id));
      expect(rows.map((r) => r.objectKey)).toEqual([envelope.data.objectKey]);
      const filename = envelope.data.objectKey.split('/')[1];
      const served = await readLocalUpload(filename);
      expect(served && new Uint8Array(served)).toEqual(bytes);
    });

    it('400s a non-image, even one lying about its content-type', async () => {
      const category = await makeCategory();
      const product = await makeProduct(category);
      asAdmin();
      const notAnImage = new File(
        [Uint8Array.from(new TextEncoder().encode('<?php echo 1; ?>'))],
        'evil.jpg',
        { type: 'image/jpeg' },
      );
      const res = await upload(product.id, notAnImage);
      expect(res.status).toBe(400);
    });

    it('400s when no file field is present', async () => {
      const category = await makeCategory();
      const product = await makeProduct(category);
      asAdmin();
      const res = await upload(product.id, undefined);
      expect(res.status).toBe(400);
    });

    it('413s a file over the size limit before storing it', async () => {
      const category = await makeCategory();
      const product = await makeProduct(category);
      asAdmin();
      const big = jpegBytes(MAX_UPLOAD_BYTES + 1024);
      const res = await upload(
        product.id,
        new File([big], 'big.jpg', { type: 'image/jpeg' }),
      );
      expect(res.status).toBe(413);
    });

    it('404s an unknown product and 400s a malformed id', async () => {
      asAdmin();
      const missing = await upload(
        faker.string.uuid(),
        new File([jpegBytes()], 'x.jpg', { type: 'image/jpeg' }),
      );
      expect(missing.status).toBe(404);

      const malformed = await upload(
        'not-a-uuid',
        new File([jpegBytes()], 'x.jpg', { type: 'image/jpeg' }),
      );
      expect(malformed.status).toBe(400);
    });
  });

  // ── Product families ──────────────────────────────────────────────────────

  describe('product families', () => {
    beforeEach(asAdmin);

    /** Creates a product through the route and returns the created row. */
    const create = async (
      category: Category,
      over: Record<string, unknown> = {},
    ) => {
      const { status, body: envelope } = await parse<{
        id: string;
        variantOf: string | null;
        variantLabel: string | null;
        stock: number;
      }>(await json(API_PATHS.ADMIN_PRODUCTS, 'POST', body(category, over)));
      expect(status).toBe(201);
      if (envelope.status !== 'success') throw new Error('create failed');
      return envelope.data;
    };

    it('round-trips both fields on create and reports them back', async () => {
      const category = await makeCategory();
      const head = await create(category, { variantLabel: 'لاوندر' });

      expect(head.variantOf).toBeNull();
      expect(head.variantLabel).toBe('لاوندر');

      const member = await create(category, {
        variantOf: head.id,
        variantLabel: 'اقیانوس',
      });
      expect(member.variantOf).toBe(head.id);
      expect(member.variantLabel).toBe('اقیانوس');
    });

    it('keeps both null for a product that names neither', async () => {
      const category = await makeCategory();
      const plain = await create(category);

      expect(plain.variantOf).toBeNull();
      expect(plain.variantLabel).toBeNull();
    });

    it('refuses a second level, on the field the form renders', async () => {
      const category = await makeCategory();
      const head = await create(category, { variantLabel: 'لاوندر' });
      const member = await create(category, {
        variantOf: head.id,
        variantLabel: 'اقیانوس',
      });

      const { status, body: envelope } = await parse(
        await json(
          API_PATHS.ADMIN_PRODUCTS,
          'POST',
          body(category, { variantOf: member.id, variantLabel: 'بدون بو' }),
        ),
      );

      expect(status).toBe(400);
      if (envelope.status !== 'error') throw new Error('expected an error');
      expect(envelope.errors).toContain(
        `variantOf: ${VARIANT_MESSAGES.nested}`,
      );
    });

    it('refuses a head nobody has heard of', async () => {
      const category = await makeCategory();
      const { status, body: envelope } = await parse(
        await json(
          API_PATHS.ADMIN_PRODUCTS,
          'POST',
          body(category, {
            variantOf: '00000000-0000-4000-8000-000000000000',
            variantLabel: 'قرمز',
          }),
        ),
      );

      expect(status).toBe(400);
      if (envelope.status !== 'error') throw new Error('expected an error');
      expect(envelope.errors).toContain(
        `variantOf: ${VARIANT_MESSAGES.unknownHead}`,
      );
    });

    it('refuses a head that has no label of its own', async () => {
      const category = await makeCategory();
      const bare = await create(category);

      const { status, body: envelope } = await parse(
        await json(
          API_PATHS.ADMIN_PRODUCTS,
          'POST',
          body(category, { variantOf: bare.id, variantLabel: 'قرمز' }),
        ),
      );

      expect(status).toBe(400);
      if (envelope.status !== 'error') throw new Error('expected an error');
      expect(envelope.errors).toContain(
        `variantOf: ${VARIANT_MESSAGES.headNeedsLabel}`,
      );
    });

    it('answers 409 with the refusal as the message, and leaves the head alone', async () => {
      const category = await makeCategory();
      const head = await create(category, { variantLabel: 'لاوندر' });
      await create(category, { variantOf: head.id, variantLabel: 'اقیانوس' });

      const { status, body: envelope } = await parse(
        await json(apiAdminProductPath(head.id), 'DELETE'),
      );

      // The sentence is the envelope's `message`, not a field-keyed `errors[]`
      // entry: a DELETE carries no form, so there is no field to key it to —
      // and the button reads `message`. Keyed the old way it reached nobody.
      expect(status).toBe(409);
      if (envelope.status !== 'error') throw new Error('expected an error');
      expect(envelope.message).toBe(hasMembersMessage(1));

      // A refusal that half-applied would be worse than one that did not fire.
      const [row] = await testDb
        .select({ isActive: products.isActive })
        .from(products)
        .where(eq(products.id, head.id));
      expect(row.isActive).toBe(true);
    });

    it('refuses the same thing through PUT, where the checkbox writes it', async () => {
      const category = await makeCategory();
      const head = await create(category, { variantLabel: 'لاوندر' });
      await create(category, { variantOf: head.id, variantLabel: 'اقیانوس' });

      const { status, body: envelope } = await parse(
        await json(apiAdminProductPath(head.id), 'PUT', {
          ...body(category, { variantLabel: 'لاوندر', isActive: false }),
          expectedStock: head.stock,
        }),
      );

      // Unprefixed, so `parseFieldErrors` routes it to `unmapped` and the form
      // shows it in the top-level alert — there is no field for «visibility».
      expect(status).toBe(400);
      if (envelope.status !== 'error') throw new Error('expected an error');
      expect(envelope.errors).toContain(hasMembersMessage(1));
    });

    it('still deactivates an ordinary member, and only it', async () => {
      const category = await makeCategory();
      const head = await create(category, { variantLabel: 'لاوندر' });
      const member = await create(category, {
        variantOf: head.id,
        variantLabel: 'اقیانوس',
      });

      const { status, body: envelope } = await parse<{ isActive: boolean }>(
        await json(apiAdminProductPath(member.id), 'DELETE'),
      );

      expect(status).toBe(200);
      if (envelope.status !== 'success') throw new Error('expected success');
      // A 200 alone would pass on a handler that deactivated nothing — or the
      // wrong row.
      expect(envelope.data.isActive).toBe(false);
      const [headRow] = await testDb
        .select({ isActive: products.isActive })
        .from(products)
        .where(eq(products.id, head.id));
      expect(headRow.isActive).toBe(true);
    });

    it('lets an update re-point a member at another head', async () => {
      const category = await makeCategory();
      const head = await create(category, { variantLabel: 'لاوندر' });
      const other = await create(category, { variantLabel: 'یاس' });
      const member = await create(category, {
        variantOf: head.id,
        variantLabel: 'اقیانوس',
      });

      const { status, body: envelope } = await parse<{
        variantOf: string | null;
      }>(
        await json(apiAdminProductPath(member.id), 'PUT', {
          ...body(category, {
            variantOf: other.id,
            variantLabel: 'اقیانوس',
          }),
          expectedStock: member.stock,
        }),
      );

      expect(status).toBe(200);
      if (envelope.status !== 'success') throw new Error('expected success');
      expect(envelope.data.variantOf).toBe(other.id);
    });
  });
});
