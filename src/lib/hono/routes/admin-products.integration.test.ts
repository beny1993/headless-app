// Request-level tests for the admin product API, driven through the real Hono
// `app` — so what they prove is the mount order in ../index.ts (the guard runs
// before every admin handler) and the whole create/update/delete/upload path,
// not just a handler in isolation. Only the session lookup is mocked.
//
// The authz matrix is the point: every admin route answers 401 with no session,
// 403 to a customer, and succeeds for an admin — and the public product read is
// still reachable unauthenticated after the admin router is mounted, the
// regression that would catch a leaking `/admin/*` guard.
import { mkdtemp, readdir, rm } from 'node:fs/promises';
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
import { OrderFixtures } from '@/db/order-test-fixtures';
import {
  API_PATHS,
  apiAdminProductImagesPath,
  apiAdminProductPath,
} from '@/lib/constant/paths';
import {
  MAX_PRODUCT_IMAGES,
  PRODUCT_MESSAGES,
} from '@/lib/catalog/product-input';
import {
  DELETE_INTENTS,
  DELETE_OUTCOMES,
  productDeleteSearch,
  type DeleteIntent,
} from '@/lib/catalog/product-delete';
import { VARIANT_MESSAGES, hasMembersMessage } from '@/lib/catalog/variant';
import { SKU_ALPHABET, SKU_SUFFIX_LENGTH } from '@/lib/catalog/sku';
import type { ApiResponse } from '@/lib/hono/envelope';
import {
  IMAGE_TOO_LARGE_MESSAGE,
  INVALID_IMAGE_MESSAGE,
  NO_IMAGE_FILE_MESSAGE,
} from '@/lib/hono/image-upload';
import { MAX_UPLOAD_BYTES } from '@/lib/storage/image-upload';
import { VARS } from '@/lib/utils/env';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ isAuthenticatedUser: mocks.getSession }));

const { app } = await importWithDb(() => import('@/lib/hono'));
const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));
const { OrderDao } = await importWithDb(() => import('@/db/dao/OrderDao'));
const { readLocalUpload } = await importWithDb(
  () => import('@/lib/storage/local-driver'),
);

/** The DELETE path carrying the intent the admin confirmed. */
const remove = (id: string, confirm: DeleteIntent) =>
  `${apiAdminProductPath(id)}${productDeleteSearch({ confirm })}`;

/** An upload refusal: the status and the exact error envelope, message included. */
const expectRefusal = async (
  response: Response | Promise<Response>,
  status: number,
  message: string,
) => {
  const res = await response;
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ status: 'error', message });
};

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

  const json = (url: string, method: string, b?: unknown) =>
    app.request(url, {
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
      const res = await app.request(
        `${API_PATHS.PRODUCTS}/${created.body.data.slug}`,
      );
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

  // ── Delete (or deactivate) ──────────────────────────────────────────────────

  describe('DELETE /admin/products/{id}', () => {
    const orders = new OrderFixtures();
    // Orders first: `order_items` restricts, so the outer teardown could not
    // remove an ordered product while its order is still there.
    afterEach(() => orders.cleanup());

    const makeProduct = (category: Category) =>
      ProductDao.create({
        title: 'حذف‌شدنی',
        slug: `d-${faker.string.alphanumeric(8).toLowerCase()}`,
        sku: `D-${faker.string.alphanumeric(8).toUpperCase()}`,
        price: 100_000,
        stock: 3,
        categoryId: category.id,
        petTypes: [PET_TYPES.CAT],
      });

    const rowOf = async (id: string) =>
      (await testDb.select().from(products).where(eq(products.id, id)))[0];

    /** Upload one photo through the route and return its stored key. */
    const uploadPhoto = async (productId: string) => {
      const form = new FormData();
      form.set(
        'file',
        new File([jpegBytes()], 'p.jpg', { type: 'image/jpeg' }),
      );
      const uploaded = await parse<{ objectKey: string }>(
        await app.request(apiAdminProductImagesPath(productId), {
          method: 'POST',
          body: form,
        }),
      );
      if (uploaded.body.status !== 'success') throw new Error('upload failed');
      return uploaded.body.data.objectKey;
    };
    const fileExists = async (key: string) =>
      (await readLocalUpload(key.split('/')[1])) !== null;

    it('deletes a never-ordered product and answers exactly `{ outcome: deleted }`', async () => {
      const category = await makeCategory();
      const product = await makeProduct(category);
      asAdmin();

      const res = await json(
        remove(product.id, DELETE_INTENTS.DELETE),
        'DELETE',
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        status: 'success',
        data: { outcome: DELETE_OUTCOMES.DELETED },
      });
      expect(await rowOf(product.id)).toBeUndefined();
      // Gone from the admin read too, not merely hidden.
      const admin = await ProductDao.listForAdmin({
        categorySlug: category.slug,
      });
      expect(admin.map((p) => p.id)).not.toContain(product.id);
    });

    it('deactivates an ordered product and answers exactly `{ outcome: deactivated }`', async () => {
      const category = await makeCategory();
      const product = await makeProduct(category);
      const user = await orders.user();
      const order = await OrderDao.create(
        orders.buildOrder(user, [{ product }]) as Parameters<
          typeof OrderDao.create
        >[0],
      );
      orders.remember(order.id);
      asAdmin();

      // The admin confirmed «حذف»; the order turned it into a deactivation.
      const res = await json(
        remove(product.id, DELETE_INTENTS.DELETE),
        'DELETE',
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        status: 'success',
        data: { outcome: DELETE_OUTCOMES.DEACTIVATED },
      });
      // The row stays for the order behind it, hidden from the storefront and
      // still in the admin read.
      expect((await rowOf(product.id)).isActive).toBe(false);
      expect(await ProductDao.getBySlug(product.slug)).toBeNull();
      const admin = await ProductDao.listForAdmin({
        categorySlug: category.slug,
      });
      expect(admin.map((p) => p.id)).toContain(product.id);
    });

    it('deletes the uploaded photo files along with the row', async () => {
      const category = await makeCategory();
      const product = await makeProduct(category);
      asAdmin();
      const key = await uploadPhoto(product.id);
      expect(await fileExists(key)).toBe(true);

      await json(remove(product.id, DELETE_INTENTS.DELETE), 'DELETE');

      expect(await fileExists(key)).toBe(false);
    });

    it('only deactivates a deletable product when that is what was confirmed, keeping its files', async () => {
      const category = await makeCategory();
      const product = await makeProduct(category);
      asAdmin();
      const key = await uploadPhoto(product.id);

      const res = await json(
        remove(product.id, DELETE_INTENTS.DEACTIVATE),
        'DELETE',
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        status: 'success',
        data: { outcome: DELETE_OUTCOMES.DEACTIVATED },
      });
      expect((await rowOf(product.id)).isActive).toBe(false);
      expect(await fileExists(key)).toBe(true);
    });

    it.each([
      ['missing', apiAdminProductPath],
      ['unknown', (id: string) => `${apiAdminProductPath(id)}?confirm=purge`],
    ])(
      'refuses a %s intent with 400 and touches nothing',
      async (_, urlFor) => {
        const category = await makeCategory();
        const product = await makeProduct(category);
        asAdmin();

        const res = await json(urlFor(product.id), 'DELETE');

        expect(res.status).toBe(400);
        expect((await rowOf(product.id)).isActive).toBe(true);
      },
    );

    it('404s an unknown id', async () => {
      asAdmin();
      const res = await json(
        remove(faker.string.uuid(), DELETE_INTENTS.DELETE),
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
      await expectRefusal(
        upload(product.id, notAnImage),
        400,
        INVALID_IMAGE_MESSAGE,
      );
    });

    it('400s when no file field is present', async () => {
      const category = await makeCategory();
      const product = await makeProduct(category);
      asAdmin();
      await expectRefusal(
        upload(product.id, undefined),
        400,
        NO_IMAGE_FILE_MESSAGE,
      );
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
      await expectRefusal(res, 413, IMAGE_TOO_LARGE_MESSAGE);
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

    it('appends rather than replacing, keeping every earlier photo', async () => {
      const category = await makeCategory();
      const product = await makeProduct(category);
      asAdmin();

      const keys: string[] = [];
      for (let n = 0; n < 3; n += 1) {
        const { status, body: envelope } = await parse<{ objectKey: string }>(
          await upload(
            product.id,
            new File([jpegBytes()], `p${n}.jpg`, { type: 'image/jpeg' }),
          ),
        );
        expect(status).toBe(201);
        if (envelope.status !== 'success') throw new Error(envelope.message);
        keys.push(envelope.data.objectKey);
      }

      // Three rows in upload order — the first photo is the cover — and all
      // three files still readable, which the single-slot version could not do.
      const rows = await testDb
        .select()
        .from(productImages)
        .where(eq(productImages.productId, product.id))
        .orderBy(productImages.sortOrder);
      expect(rows.map((row) => row.objectKey)).toEqual(keys);
      expect(rows.map((row) => row.sortOrder)).toEqual([0, 1, 2]);
      for (const key of keys) {
        expect(await readLocalUpload(key.split('/')[1])).not.toBeNull();
      }
    });

    // The ordering of the two refusals, which is the only thing that shows the
    // ceiling is checked *before* the body is read. The existing test above
    // proves no file is left behind — which the take-back in
    // `appendProductImage` guarantees on its own, so the pre-check could be
    // deleted or moved after `readImageUpload` with the whole suite green.
    // A non-image on a full gallery separates them: the ceiling answers first
    // only if it runs first.
    it('answers the ceiling before it looks at the bytes', async () => {
      const category = await makeCategory();
      const product = await makeProduct(category);
      asAdmin();
      for (let n = 0; n < MAX_PRODUCT_IMAGES; n += 1) {
        expect(
          (
            await upload(
              product.id,
              new File([jpegBytes()], `p${n}.jpg`, { type: 'image/jpeg' }),
            )
          ).status,
        ).toBe(201);
      }

      const notAnImage = new File(
        [Uint8Array.from(new TextEncoder().encode('<?php echo 1; ?>'))],
        'evil.jpg',
        { type: 'image/jpeg' },
      );
      const { status, body: envelope } = await parse<unknown>(
        await upload(product.id, notAnImage),
      );

      expect(status).toBe(400);
      // The ceiling's sentence, not the sniffer's: the body was never read.
      expect((envelope as { message?: string }).message).toBe(
        PRODUCT_MESSAGES.imagesMax,
      );
    });

    it('refuses a sixth photo without reading or storing it', async () => {
      const category = await makeCategory();
      const product = await makeProduct(category);
      asAdmin();
      for (let n = 0; n < MAX_PRODUCT_IMAGES; n += 1) {
        expect(
          (
            await upload(
              product.id,
              new File([jpegBytes()], `p${n}.jpg`, { type: 'image/jpeg' }),
            )
          ).status,
        ).toBe(201);
      }
      const before = await readdir(storageRoot);

      const { status, body: envelope } = await parse<unknown>(
        await upload(
          product.id,
          new File([jpegBytes()], 'sixth.jpg', { type: 'image/jpeg' }),
        ),
      );

      expect(status).toBe(400);
      if (envelope.status !== 'error') throw new Error('expected a refusal');
      expect(envelope.message).toBe(PRODUCT_MESSAGES.imagesMax);
      // Still five rows, and not one extra file: the ceiling is checked before
      // the body is read, so a refused photo never reaches the disk.
      const rows = await testDb
        .select()
        .from(productImages)
        .where(eq(productImages.productId, product.id));
      expect(rows).toHaveLength(MAX_PRODUCT_IMAGES);
      expect((await readdir(storageRoot)).sort()).toEqual(before.sort());
    });
  });

  // ── Gallery order ─────────────────────────────────────────────────────────

  describe('PUT /admin/products/{id}/images', () => {
    const makeProduct = async (category: Category) =>
      ProductDao.create({
        title: 'با گالری',
        slug: `gal-${faker.string.alphanumeric(8).toLowerCase()}`,
        sku: `GAL-${faker.string.alphanumeric(8).toUpperCase()}`,
        price: 100_000,
        stock: 3,
        categoryId: category.id,
        petTypes: [PET_TYPES.CAT],
      });

    /** A product carrying `count` uploaded photos, and their keys in order. */
    const withPhotos = async (count: number) => {
      const category = await makeCategory();
      const product = await makeProduct(category);
      const keys: string[] = [];
      for (let n = 0; n < count; n += 1) {
        const { body: envelope } = await parse<{ objectKey: string }>(
          await app.request(apiAdminProductImagesPath(product.id), {
            method: 'POST',
            body: (() => {
              const form = new FormData();
              form.set(
                'file',
                new File([jpegBytes()], `p${n}.jpg`, { type: 'image/jpeg' }),
              );
              return form;
            })(),
          }),
        );
        if (envelope.status !== 'success') throw new Error(envelope.message);
        keys.push(envelope.data.objectKey);
      }
      return { product, keys };
    };

    const storedKeys = async (productId: string) =>
      (
        await testDb
          .select()
          .from(productImages)
          .where(eq(productImages.productId, productId))
          .orderBy(productImages.sortOrder)
      ).map((row) => row.objectKey);

    const fileExists = async (key: string) =>
      (await readLocalUpload(key.split('/')[1])) !== null;

    beforeEach(asAdmin);

    it('stores the order it is given and deletes nothing', async () => {
      const { product, keys } = await withPhotos(3);
      const reordered = [keys[2], keys[0], keys[1]];

      const { status } = await parse<unknown>(
        await json(apiAdminProductImagesPath(product.id), 'PUT', {
          objectKeys: reordered,
        }),
      );

      expect(status).toBe(200);
      expect(await storedKeys(product.id)).toEqual(reordered);
      for (const key of keys) expect(await fileExists(key)).toBe(true);
    });

    it('deletes the file of the photo the admin dropped, and only that one', async () => {
      const { product, keys } = await withPhotos(3);

      await json(apiAdminProductImagesPath(product.id), 'PUT', {
        objectKeys: [keys[0], keys[2]],
      });

      expect(await storedKeys(product.id)).toEqual([keys[0], keys[2]]);
      expect(await fileExists(keys[1])).toBe(false);
      expect(await fileExists(keys[0])).toBe(true);
      expect(await fileExists(keys[2])).toBe(true);
    });

    it('refuses another product’s key and leaves both galleries alone', async () => {
      const mine = await withPhotos(2);
      const theirs = await withPhotos(2);

      const { status, body: envelope } = await parse<unknown>(
        await json(apiAdminProductImagesPath(mine.product.id), 'PUT', {
          objectKeys: [mine.keys[0], theirs.keys[0]],
        }),
      );

      expect(status).toBe(400);
      if (envelope.status !== 'error') throw new Error('expected a refusal');
      expect(envelope.message).toBe(PRODUCT_MESSAGES.images);
      // Nothing written and nothing deleted, on either product.
      expect(await storedKeys(mine.product.id)).toEqual(mine.keys);
      expect(await storedKeys(theirs.product.id)).toEqual(theirs.keys);
      for (const key of [...mine.keys, ...theirs.keys]) {
        expect(await fileExists(key)).toBe(true);
      }
    });

    it.each([
      ['a bundled seed key', ['products/cat-dry-food.jpg']],
      ['an arbitrary string', ['../../etc/passwd']],
      ['a repeated key', null],
    ])('refuses %s', async (_name, keys) => {
      const { product, keys: own } = await withPhotos(2);

      const { status } = await parse<unknown>(
        await json(apiAdminProductImagesPath(product.id), 'PUT', {
          objectKeys: keys ?? [own[0], own[0]],
        }),
      );

      expect(status).toBe(400);
      expect(await storedKeys(product.id)).toEqual(own);
    });

    it('refuses more keys than the ceiling allows', async () => {
      const { product, keys } = await withPhotos(2);

      const { status, body: envelope } = await parse<unknown>(
        await json(apiAdminProductImagesPath(product.id), 'PUT', {
          objectKeys: Array.from(
            { length: MAX_PRODUCT_IMAGES + 1 },
            (_, n) => `uploads/${n}.jpg`,
          ),
        }),
      );

      expect(status).toBe(400);
      if (envelope.status !== 'error') throw new Error('expected a refusal');
      expect(JSON.stringify(envelope)).toContain(PRODUCT_MESSAGES.imagesMax);
      expect(await storedKeys(product.id)).toEqual(keys);
    });

    it('clears the gallery when the admin removes every photo', async () => {
      const { product, keys } = await withPhotos(2);

      const { status } = await parse<unknown>(
        await json(apiAdminProductImagesPath(product.id), 'PUT', {
          objectKeys: [],
        }),
      );

      expect(status).toBe(200);
      expect(await storedKeys(product.id)).toEqual([]);
      for (const key of keys) expect(await fileExists(key)).toBe(false);
    });

    it('404s an unknown product', async () => {
      const { status } = await parse<unknown>(
        await json(apiAdminProductImagesPath(faker.string.uuid()), 'PUT', {
          objectKeys: [],
        }),
      );
      expect(status).toBe(404);
    });

    it('turns away anonymous callers and customers', async () => {
      const { product, keys } = await withPhotos(1);

      anon();
      expect(
        (
          await json(apiAdminProductImagesPath(product.id), 'PUT', {
            objectKeys: [],
          })
        ).status,
      ).toBe(401);

      asCustomer();
      expect(
        (
          await json(apiAdminProductImagesPath(product.id), 'PUT', {
            objectKeys: [],
          })
        ).status,
      ).toBe(403);

      asAdmin();
      expect(await storedKeys(product.id)).toEqual(keys);
      expect(await fileExists(keys[0])).toBe(true);
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

    it('refuses an inactive head, on the select the admin picked it in', async () => {
      const category = await makeCategory();
      const head = await create(category, { variantLabel: 'لاوندر' });
      // Deactivated directly: through the DELETE route a head nothing points
      // at is deleted outright, and the refusal would be «unknown head».
      await ProductDao.softDelete(head.id);

      const { status, body: envelope } = await parse(
        await json(
          API_PATHS.ADMIN_PRODUCTS,
          'POST',
          body(category, { variantOf: head.id, variantLabel: 'اقیانوس' }),
        ),
      );

      expect(status).toBe(400);
      if (envelope.status !== 'error') throw new Error('expected an error');
      expect(envelope.errors).toContain(
        `variantOf: ${VARIANT_MESSAGES.inactiveHead}`,
      );
    });

    it('keys a head clearing its own label to the label, not the disabled select', async () => {
      const category = await makeCategory();
      const head = await create(category, { variantLabel: 'لاوندر' });
      await create(category, { variantOf: head.id, variantLabel: 'اقیانوس' });

      const { status, body: envelope } = await parse(
        await json(apiAdminProductPath(head.id), 'PUT', {
          ...body(category, { variantLabel: '' }),
          expectedStock: head.stock,
        }),
      );

      // Same rule, two meanings. Sent *with* a `variantOf` it is «the head you
      // picked has no label» and belongs on that select; sent without one — as
      // here — it is «you cleared your own», and the select is disabled for a
      // row with members, so keying it there points at a control the admin
      // cannot use.
      expect(status).toBe(400);
      if (envelope.status !== 'error') throw new Error('expected an error');
      expect(envelope.errors).toContain(
        `variantLabel: ${VARIANT_MESSAGES.headNeedsLabel}`,
      );
    });

    it('answers 409 with the refusal as the message, and leaves the head alone', async () => {
      const category = await makeCategory();
      const head = await create(category, { variantLabel: 'لاوندر' });
      await create(category, { variantOf: head.id, variantLabel: 'اقیانوس' });

      const { status, body: envelope } = await parse(
        await json(remove(head.id, DELETE_INTENTS.DEACTIVATE), 'DELETE'),
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

    it('deletes an ordinary member, and only it', async () => {
      const category = await makeCategory();
      const head = await create(category, { variantLabel: 'لاوندر' });
      const member = await create(category, {
        variantOf: head.id,
        variantLabel: 'اقیانوس',
      });

      const { status, body: envelope } = await parse<{ outcome: string }>(
        await json(remove(member.id, DELETE_INTENTS.DELETE), 'DELETE'),
      );

      expect(status).toBe(200);
      if (envelope.status !== 'success') throw new Error('expected success');
      // A 200 alone would pass on a handler that removed nothing — or the
      // wrong row.
      expect(envelope.data.outcome).toBe(DELETE_OUTCOMES.DELETED);
      const rows = await testDb
        .select({ id: products.id, isActive: products.isActive })
        .from(products)
        .where(inArray(products.id, [head.id, member.id]));
      expect(rows).toEqual([{ id: head.id, isActive: true }]);
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
