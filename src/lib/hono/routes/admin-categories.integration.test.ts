// Request-level tests for the admin category API, driven through the real Hono
// `app` — so what they prove is the mount in ../index.ts (the `/admin/*` guard
// covers these routes and does not leak onto the public `GET /api/categories`)
// and the whole create/update/delete path, not a handler in isolation. Only the
// session lookup is mocked.
import { faker } from '@faker-js/faker';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { categories, products } from '@/db/schema/catalog';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import {
  CATEGORY_MESSAGES,
  CATEGORY_PARENT_MESSAGES,
} from '@/lib/catalog/category-input';
import { PET_TYPES } from '@/lib/catalog/product-query';
import { API_PATHS, apiAdminCategoryPath } from '@/lib/constant/paths';
import { formatNumber } from '@/lib/format';
import type { ApiResponse } from '@/lib/hono/envelope';
import type { CategoryView } from '@/lib/hono/routes/admin-categories';
import { IMAGE_KEY_ERROR } from '@/lib/storage/image-upload';

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ isAuthenticatedUser: mocks.getSession }));

const { app } = await importWithDb(() => import('@/lib/hono'));
const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));
const { CATEGORY_NOT_FOUND_MESSAGE, categoryInUseMessage } = await importWithDb(
  () => import('@/lib/hono/routes/admin-categories'),
);

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

describe.skipIf(!databaseReachable)('admin category API', () => {
  const categoryIds: string[] = [];

  const body = (over: Record<string, unknown> = {}) => ({
    title: 'غذای خشک',
    slug: `cat-${faker.string.alphanumeric(10).toLowerCase()}`,
    sortOrder: 0,
    ...over,
  });

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

  /** Create through the API as the admin, tracked for teardown. */
  const create = async (over: Record<string, unknown> = {}) => {
    asAdmin();
    const res = await parse<CategoryView>(
      await json(API_PATHS.ADMIN_CATEGORIES, 'POST', body(over)),
    );
    if (res.body.status !== 'success') throw new Error(res.body.message);
    categoryIds.push(res.body.data.id);
    return res.body.data;
  };

  const makeProduct = (categoryId: string) => {
    const token = faker.string.alphanumeric(10).toLowerCase();
    return ProductDao.create({
      title: 'محصول آزمایشی',
      slug: `p-${token}`,
      sku: `SKU-${token.toUpperCase()}`,
      price: 100_000,
      stock: 1,
      categoryId,
      petTypes: [PET_TYPES.CAT],
    });
  };

  const rowsFor = (id: string) =>
    testDb.select().from(categories).where(eq(categories.id, id));

  afterEach(async () => {
    mocks.getSession.mockReset();
    if (categoryIds.length > 0) {
      await testDb
        .delete(products)
        .where(inArray(products.categoryId, categoryIds));
      await testDb
        .delete(categories)
        .where(inArray(categories.id, categoryIds));
      categoryIds.length = 0;
    }
  });

  // ── Authz matrix ────────────────────────────────────────────────────────────

  describe('authorization', () => {
    // Bodies carry `parentId`: the guard must refuse before anything looks a
    // parent up, so a stranger cannot probe which category ids exist.
    const everyRoute = (id: string) => [
      json(
        API_PATHS.ADMIN_CATEGORIES,
        'POST',
        body({ parentId: faker.string.uuid() }),
      ),
      json(
        apiAdminCategoryPath(id),
        'PUT',
        body({ parentId: faker.string.uuid() }),
      ),
      json(apiAdminCategoryPath(id), 'DELETE'),
    ];

    it('answers 401 without a session on every admin category route', async () => {
      anon();
      const calls = await Promise.all(everyRoute(faker.string.uuid()));
      expect(calls.map((c) => c.status)).toEqual([401, 401, 401]);
    });

    it('answers 403 to a signed-in customer on every admin category route', async () => {
      asCustomer();
      const calls = await Promise.all(everyRoute(faker.string.uuid()));
      expect(calls.map((c) => c.status)).toEqual([403, 403, 403]);
    });

    it('refuses before it parses the body — a customer POSTing junk still gets 403', async () => {
      asCustomer();
      const res = await json(API_PATHS.ADMIN_CATEGORIES, 'POST', {
        sortOrder: 'not-a-number',
      });
      expect(res.status).toBe(403);
    });

    it('a customer cannot delete a real category', async () => {
      const existing = await create();
      asCustomer();
      const res = await json(apiAdminCategoryPath(existing.id), 'DELETE');
      expect(res.status).toBe(403);
      expect(await rowsFor(existing.id)).toHaveLength(1);
    });

    it('leaves the public category list public', async () => {
      anon();
      const res = await json(API_PATHS.CATEGORIES, 'GET');
      expect(res.status).toBe(200);
    });
  });

  // ── Create ──────────────────────────────────────────────────────────────────

  describe('POST /admin/categories', () => {
    it('creates a category (201), trimming the title and ignoring a client id', async () => {
      asAdmin();
      const pinned = faker.string.uuid();
      const res = await parse<CategoryView>(
        await json(API_PATHS.ADMIN_CATEGORIES, 'POST', {
          ...body({ title: '  اسباب‌بازی  ', sortOrder: 4 }),
          id: pinned,
        }),
      );

      expect(res.status).toBe(201);
      if (res.body.status !== 'success') throw new Error(res.body.message);
      categoryIds.push(res.body.data.id);
      expect(res.body.data.id).not.toBe(pinned);
      expect(res.body.data).toMatchObject({
        title: 'اسباب‌بازی',
        sortOrder: 4,
      });
    });

    it('shows up on the public list immediately, in sort order', async () => {
      const later = await create({ title: 'ب', sortOrder: 2_000_000_001 });
      const earlier = await create({ title: 'الف', sortOrder: 2_000_000_000 });

      anon();
      const listed = await parse<{ slug: string }[]>(
        await json(API_PATHS.CATEGORIES, 'GET'),
      );
      if (listed.body.status !== 'success') throw new Error('list failed');
      const ours = listed.body.data
        .map((c) => c.slug)
        .filter((s) => s === earlier.slug || s === later.slug);

      expect(ours).toEqual([earlier.slug, later.slug]);
    });

    it('refuses a duplicate slug with a field-scoped Persian error (400)', async () => {
      const existing = await create();
      asAdmin();

      const res = await parse(
        await json(
          API_PATHS.ADMIN_CATEGORIES,
          'POST',
          body({ slug: existing.slug }),
        ),
      );

      expect(res.status).toBe(400);
      if (res.body.status !== 'error') throw new Error('expected an error');
      expect(res.body.errors?.some((e) => e.startsWith('slug: '))).toBe(true);
    });

    it('rejects a bad slug and a blank title with the shared schema messages (400)', async () => {
      asAdmin();

      const res = await parse(
        await json(
          API_PATHS.ADMIN_CATEGORIES,
          'POST',
          body({ slug: 'Bad Slug', title: '   ' }),
        ),
      );

      expect(res.status).toBe(400);
      if (res.body.status !== 'error') throw new Error('expected an error');
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          `slug: ${CATEGORY_MESSAGES.slug}`,
          `title: ${CATEGORY_MESSAGES.title}`,
        ]),
      );
    });
    it('refuses a NUL byte in the title with 400, not a database 500', async () => {
      asAdmin();

      const res = await parse(
        await json(
          API_PATHS.ADMIN_CATEGORIES,
          'POST',
          body({ title: `غذا${String.fromCharCode(0)}` }),
        ),
      );

      expect(res.status).toBe(400);
      if (res.body.status !== 'error') throw new Error('expected an error');
      expect(res.body.errors).toContain(
        `title: ${CATEGORY_MESSAGES.titleChars}`,
      );
    });
  });

  // ── Update ──────────────────────────────────────────────────────────────────

  describe('PUT /admin/categories/{id}', () => {
    it('replaces the title, slug and sort order (200)', async () => {
      const existing = await create({ sortOrder: 1 });
      const nextSlug = `cat-${faker.string.alphanumeric(10).toLowerCase()}`;
      asAdmin();

      const res = await parse<CategoryView>(
        await json(
          apiAdminCategoryPath(existing.id),
          'PUT',
          body({ title: 'غذای تر', slug: nextSlug, sortOrder: 9 }),
        ),
      );

      expect(res.status).toBe(200);
      if (res.body.status !== 'success') throw new Error(res.body.message);
      expect(res.body.data).toMatchObject({
        id: existing.id,
        title: 'غذای تر',
        slug: nextSlug,
        sortOrder: 9,
      });
    });

    it('keeps its own slug when only the title changes', async () => {
      const existing = await create();
      asAdmin();

      const res = await json(
        apiAdminCategoryPath(existing.id),
        'PUT',
        body({ title: 'عنوان تازه', slug: existing.slug }),
      );

      expect(res.status).toBe(200);
    });

    it('answers 404 for an unknown id', async () => {
      asAdmin();

      const res = await parse(
        await json(apiAdminCategoryPath(faker.string.uuid()), 'PUT', body()),
      );

      expect(res.status).toBe(404);
      if (res.body.status !== 'error') throw new Error('expected an error');
      expect(res.body.message).toBe(CATEGORY_NOT_FOUND_MESSAGE);
    });

    it('refuses renaming onto another category’s slug (400)', async () => {
      const taken = await create();
      const other = await create();
      asAdmin();

      const res = await parse(
        await json(
          apiAdminCategoryPath(other.id),
          'PUT',
          body({ slug: taken.slug }),
        ),
      );

      expect(res.status).toBe(400);
      if (res.body.status !== 'error') throw new Error('expected an error');
      expect(res.body.errors?.some((e) => e.startsWith('slug: '))).toBe(true);
    });

    it('rejects a malformed id (400)', async () => {
      asAdmin();
      const res = await json(
        `${API_PATHS.ADMIN_CATEGORIES}/not-a-uuid`,
        'PUT',
        body(),
      );
      expect(res.status).toBe(400);
    });
  });

  // ── Delete ──────────────────────────────────────────────────────────────────

  describe('DELETE /admin/categories/{id}', () => {
    it('removes an unreferenced category (200)', async () => {
      const existing = await create();
      asAdmin();

      const res = await json(apiAdminCategoryPath(existing.id), 'DELETE');

      expect(res.status).toBe(200);
      expect(await rowsFor(existing.id)).toHaveLength(0);
    });

    it('answers 404 for an unknown id', async () => {
      asAdmin();

      const res = await parse(
        await json(apiAdminCategoryPath(faker.string.uuid()), 'DELETE'),
      );

      expect(res.status).toBe(404);
      if (res.body.status !== 'error') throw new Error('expected an error');
      expect(res.body.message).toBe(CATEGORY_NOT_FOUND_MESSAGE);
    });

    it('refuses (409) while products reference it, naming how many', async () => {
      const existing = await create();
      await makeProduct(existing.id);
      await makeProduct(existing.id);
      asAdmin();

      const res = await parse(
        await json(apiAdminCategoryPath(existing.id), 'DELETE'),
      );

      expect(res.status).toBe(409);
      if (res.body.status !== 'error') throw new Error('expected an error');
      expect(res.body.message).toBe(categoryInUseMessage(2));
      expect(res.body.message).toContain(formatNumber(2));
      expect(await rowsFor(existing.id)).toHaveLength(1);
    });

    it('refuses (409) while sub-categories sit under it, naming how many', async () => {
      const parent = await create();
      await create({ parentId: parent.id });
      await create({ parentId: parent.id });
      asAdmin();

      const res = await parse(
        await json(apiAdminCategoryPath(parent.id), 'DELETE'),
      );

      expect(res.status).toBe(409);
      if (res.body.status !== 'error') throw new Error('expected an error');
      expect(res.body.message).toBe(categoryInUseMessage(0, 2));
      expect(res.body.message).toContain(formatNumber(2));
      expect(await rowsFor(parent.id)).toHaveLength(1);
    });

    it('names both blockers when a category has sub-categories and products', async () => {
      const parent = await create();
      await create({ parentId: parent.id });
      await makeProduct(parent.id);
      asAdmin();

      const res = await parse(
        await json(apiAdminCategoryPath(parent.id), 'DELETE'),
      );

      expect(res.status).toBe(409);
      if (res.body.status !== 'error') throw new Error('expected an error');
      expect(res.body.message).toBe(categoryInUseMessage(1, 1));
      expect(res.body.message).toContain('زیردسته');
      expect(res.body.message).toContain('محصول');
    });

    it('refuses (409) while it is only an additional category of a product', async () => {
      // The fix here is to untick the category on the product, not to move the
      // product — but the refusal must come, and must count it.
      const primary = await create();
      const extra = await create();
      const product = await makeProduct(primary.id);
      await ProductDao.update(product.id, { extraCategoryIds: [extra.id] });
      asAdmin();

      const res = await parse(
        await json(apiAdminCategoryPath(extra.id), 'DELETE'),
      );

      expect(res.status).toBe(409);
      if (res.body.status !== 'error') throw new Error('expected an error');
      expect(res.body.message).toBe(categoryInUseMessage(1));
      expect(await rowsFor(extra.id)).toHaveLength(1);
    });

    it('still refuses (409) when its only products are soft-deleted, and says so', async () => {
      const existing = await create();
      const hidden = await makeProduct(existing.id);
      await ProductDao.softDelete(hidden.id);
      asAdmin();

      const res = await parse(
        await json(apiAdminCategoryPath(existing.id), 'DELETE'),
      );

      expect(res.status).toBe(409);
      if (res.body.status !== 'error') throw new Error('expected an error');
      expect(res.body.message).toBe(categoryInUseMessage(1));
      expect(res.body.message).toContain('غیرفعال');
      expect(await rowsFor(existing.id)).toHaveLength(1);
    });
  });

  // ── Sub-categories ──────────────────────────────────────────────────────────

  describe('parentId', () => {
    /** The refusal as the manager reads it: one `parentId: …` field error. */
    const parentError = async (res: { body: ApiResponse<unknown> }) => {
      if (res.body.status !== 'error') throw new Error('expected an error');
      return res.body.errors;
    };

    it('round-trips a parent through create, move and promote', async () => {
      const parent = await create();
      const other = await create();
      const sub = await create({ parentId: parent.id });
      asAdmin();

      const moved = await parse<CategoryView>(
        await json(
          apiAdminCategoryPath(sub.id),
          'PUT',
          body({ slug: sub.slug, parentId: other.id }),
        ),
      );
      const promoted = await parse<CategoryView>(
        await json(
          apiAdminCategoryPath(sub.id),
          'PUT',
          body({ slug: sub.slug }),
        ),
      );

      expect(sub.parentId).toBe(parent.id);
      if (moved.body.status !== 'success') throw new Error(moved.body.message);
      expect(moved.body.data.parentId).toBe(other.id);
      // An omitted `parentId` is «top-level», because PUT replaces every field
      // but the photo.
      if (promoted.body.status !== 'success')
        throw new Error(promoted.body.message);
      expect(promoted.body.data.parentId).toBeNull();
    });

    it('refuses a category as its own parent (400)', async () => {
      const existing = await create();
      asAdmin();

      const res = await parse(
        await json(
          apiAdminCategoryPath(existing.id),
          'PUT',
          body({ slug: existing.slug, parentId: existing.id }),
        ),
      );

      expect(res.status).toBe(400);
      expect(await parentError(res)).toEqual([
        `parentId: ${CATEGORY_PARENT_MESSAGES.self}`,
      ]);
    });

    it('refuses a parent that is itself a sub-category (400)', async () => {
      const parent = await create();
      const sub = await create({ parentId: parent.id });
      asAdmin();

      const res = await parse(
        await json(
          API_PATHS.ADMIN_CATEGORIES,
          'POST',
          body({ parentId: sub.id }),
        ),
      );

      expect(res.status).toBe(400);
      expect(await parentError(res)).toEqual([
        `parentId: ${CATEGORY_PARENT_MESSAGES.nested}`,
      ]);
    });

    it('refuses giving a parent to a category that has sub-categories (400)', async () => {
      const parent = await create();
      await create({ parentId: parent.id });
      const other = await create();
      asAdmin();

      const res = await parse(
        await json(
          apiAdminCategoryPath(parent.id),
          'PUT',
          body({ slug: parent.slug, parentId: other.id }),
        ),
      );

      expect(res.status).toBe(400);
      expect(await parentError(res)).toEqual([
        `parentId: ${CATEGORY_PARENT_MESSAGES.hasChildren}`,
      ]);
    });

    it('refuses an unknown parent with 400, never a 23503-shaped 500', async () => {
      asAdmin();

      const res = await parse(
        await json(
          API_PATHS.ADMIN_CATEGORIES,
          'POST',
          body({ parentId: faker.string.uuid() }),
        ),
      );

      expect(res.status).toBe(400);
      expect(await parentError(res)).toEqual([
        `parentId: ${CATEGORY_PARENT_MESSAGES.unknown}`,
      ]);
    });

    it('refuses a malformed parent id with the schema’s Persian message', async () => {
      asAdmin();

      const res = await parse(
        await json(
          API_PATHS.ADMIN_CATEGORIES,
          'POST',
          body({ parentId: 'not-a-uuid' }),
        ),
      );

      expect(res.status).toBe(400);
      expect(await parentError(res)).toEqual([
        `parentId: ${CATEGORY_MESSAGES.parent}`,
      ]);
    });
  });

  // ── imageKey ────────────────────────────────────────────────────────────────

  describe('imageKey', () => {
    // Keys only — the manager uploads the file through the content-image route
    // first, so nothing here needs a file behind the key.
    const UPLOAD_KEY = 'uploads/123e4567-e89b-42d3-a456-426614174000.jpg';
    const OTHER_KEY = 'uploads/223e4567-e89b-42d3-a456-426614174000.webp';

    it('round-trips a photo through create, replace and remove', async () => {
      const created = await create({ imageKey: UPLOAD_KEY });
      expect(created.imageKey).toBe(UPLOAD_KEY);

      asAdmin();
      const replaced = await parse<CategoryView>(
        await json(
          apiAdminCategoryPath(created.id),
          'PUT',
          body({ slug: created.slug, imageKey: OTHER_KEY }),
        ),
      );
      expect(replaced.status).toBe(200);
      if (replaced.body.status !== 'success') throw new Error('replace failed');
      expect(replaced.body.data.imageKey).toBe(OTHER_KEY);

      // A body that says nothing of the photo — what an admin tab opened
      // before photos shipped sends — keeps it.
      const kept = await parse<CategoryView>(
        await json(
          apiAdminCategoryPath(created.id),
          'PUT',
          body({ slug: created.slug, title: 'غذای خشک گربه' }),
        ),
      );
      if (kept.body.status !== 'success') throw new Error('rename failed');
      expect(kept.body.data).toMatchObject({
        title: 'غذای خشک گربه',
        imageKey: OTHER_KEY,
      });

      // Only an explicit null removes it.
      const removed = await parse<CategoryView>(
        await json(
          apiAdminCategoryPath(created.id),
          'PUT',
          body({ slug: created.slug, imageKey: null }),
        ),
      );
      if (removed.body.status !== 'success') throw new Error('remove failed');
      expect(removed.body.data.imageKey).toBeNull();
      expect((await rowsFor(created.id))[0]?.imageKey).toBeNull();
    });

    it.each(['https://example.com/cat.jpg', 'uploads/../../.env', 42])(
      'refuses the key %j with the shared Persian message and writes nothing',
      async (imageKey) => {
        const existing = await create({ imageKey: UPLOAD_KEY });
        const slug = `cat-${faker.string.alphanumeric(10).toLowerCase()}`;
        asAdmin();

        const refusedCreate = await parse(
          await json(
            API_PATHS.ADMIN_CATEGORIES,
            'POST',
            body({ slug, imageKey }),
          ),
        );
        const refusedUpdate = await parse(
          await json(
            apiAdminCategoryPath(existing.id),
            'PUT',
            body({ slug: existing.slug, imageKey }),
          ),
        );

        for (const res of [refusedCreate, refusedUpdate]) {
          expect(res.status).toBe(400);
          if (res.body.status !== 'error') throw new Error('expected an error');
          expect(res.body.errors).toContain(`imageKey: ${IMAGE_KEY_ERROR}`);
        }
        expect(
          await testDb
            .select()
            .from(categories)
            .where(eq(categories.slug, slug)),
        ).toHaveLength(0);
        expect((await rowsFor(existing.id))[0]?.imageKey).toBe(UPLOAD_KEY);
      },
    );
  });
});
