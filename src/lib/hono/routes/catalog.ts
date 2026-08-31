// The public storefront catalog API: category list, product list, product
// detail. Read-only and unauthenticated by design — admin writes arrive with
// [[Story - Admin Product Management]] and get their own admin-only router.
//
// Route pattern, as in ./health.ts: a `createRoute` definition plus a separate
// typed `RouteHandler` export, never a handler inlined into `app.openapi()`.
//
// The schemas below are the API's contract. The storefront stories import the
// inferred types from here rather than re-describing the payload — that is why
// they and their `z.infer` aliases are exported.
// `z` from `zod`, not from `@hono/zod-openapi` — see the note in ../envelope.ts.
// It is what makes the `z.infer` aliases below real types rather than `any`.
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { z } from 'zod';
import { CategoryDao } from '@/db/dao/CategoryDao';
import { ProductDao } from '@/db/dao/ProductDao';
import {
  MAX_PRODUCT_PAGE_SIZE,
  PET_TYPES,
  productListQueryShape,
} from '@/lib/catalog/product-query';
import { type Category, type ProductWithImages } from '@/db/schema/catalog';
import {
  apiError,
  apiErrorSchema,
  apiSuccess,
  apiSuccessSchema,
} from '../envelope';

/** User-facing copy, so Persian. `errors` stays English developer detail. */
export const PRODUCT_NOT_FOUND_MESSAGE = 'محصول یافت نشد';

const CategorySchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    slug: z.string(),
    sortOrder: z.number().int(),
  })
  .openapi('Category');

const ProductImageSchema = z
  .object({
    id: z.uuid(),
    /**
     * A storage key, not a URL — `products/cat-toy.jpg`. Resolving it to a URL
     * is the storage interface's job, not this endpoint's.
     */
    objectKey: z.string(),
    sortOrder: z.number().int(),
  })
  .openapi('ProductImage');

const ProductSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    slug: z.string(),
    sku: z.string(),
    brand: z.string().nullable(),
    benefit: z.string().nullable(),
    description: z.string().nullable(),
    /** Integer Toman. Never a float, never a string. */
    price: z.number().int().positive(),
    oldPrice: z.number().int().positive().nullable(),
    stock: z.number().int().nonnegative(),
    petType: z.enum([PET_TYPES.CAT, PET_TYPES.DOG]),
    categoryId: z.uuid(),
    createdAt: z.iso.datetime(),
    images: z.array(ProductImageSchema),
  })
  .openapi('Product');

const ProductListSchema = z
  .object({
    items: z.array(ProductSchema),
    /** One-based, echoed back so a client can trust what it is rendering. */
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    /** Matches on the whole filtered result, not on this page. */
    total: z.number().int().nonnegative(),
    /** Zero when nothing matched — there is no page to link to. */
    totalPages: z.number().int().nonnegative(),
  })
  .openapi('ProductList');

/**
 * The validation lives in `@/lib/catalog/product-query`; this adds the
 * documentation. Splitting them is what lets the storefront's `/shop` parser
 * derive its own leniency from these exact field schemas — it is a client
 * module, so it cannot import this file, and a second hand-written copy of the
 * bounds is precisely the drift the split removes. Only descriptions are
 * spelled out here; no bound, enum or default is restated.
 *
 * `.meta()`, not `.openapi()`, and that is load-bearing. `.openapi()` is
 * grafted on by `@hono/zod-openapi` when it is imported, and zod 4 hands the
 * method to newly built schemas only — a schema constructed before that import
 * never gets one, however early the import appears in this file. The shared
 * fields are built in another module, so whether they had `.openapi()` came
 * down to module evaluation order, which flipped between the unit and
 * integration suites (`TypeError: …openapi is not a function`). `.meta()` is
 * native zod, present on every schema whenever it was built, and the OpenAPI
 * generator reads it — the doc below is asserted in ./catalog.test.ts.
 */
const ProductListQuerySchema = z.object({
  category: productListQueryShape.category.meta({
    description: 'Category slug, as returned by GET /api/categories.',
    example: 'dry-food',
  }),
  pet: productListQueryShape.pet.meta({
    description: 'Restrict to one pet type.',
  }),
  sort: productListQueryShape.sort.meta({
    description: 'Ordering. Defaults to newest first.',
  }),
  minPrice: productListQueryShape.minPrice.meta({
    description: 'Inclusive lower bound, integer Toman.',
  }),
  maxPrice: productListQueryShape.maxPrice.meta({
    description: 'Inclusive upper bound, integer Toman.',
  }),
  page: productListQueryShape.page.meta({
    description: 'One-based page number.',
  }),
  limit: productListQueryShape.limit.meta({
    description: `Page size, at most ${MAX_PRODUCT_PAGE_SIZE}.`,
  }),
});

const ProductSlugParamSchema = z.object({
  slug: z
    .string()
    .min(1)
    .openapi({ param: { name: 'slug', in: 'path' }, example: 'cat-dry-food' }),
});

/** The catalog payloads the storefront renders. Import these, don't restate them. */
export type CategoryResponse = z.infer<typeof CategorySchema>;
export type ProductImageResponse = z.infer<typeof ProductImageSchema>;
export type ProductResponse = z.infer<typeof ProductSchema>;
export type ProductListResponse = z.infer<typeof ProductListSchema>;
export type ProductListQuery = z.infer<typeof ProductListQuerySchema>;

const toCategoryResponse = (row: Category): CategoryResponse => ({
  id: row.id,
  title: row.title,
  slug: row.slug,
  sortOrder: row.sortOrder,
});

/**
 * The serialization boundary, written out field by field on purpose.
 *
 * Two things ride on it. `is_active` and `updated_at` are internal and cannot
 * leak through a spread somebody adds to the row later. And `created_at` is a
 * `Date`, which only becomes a string by accident inside `JSON.stringify` —
 * converting here is what makes the declared `z.iso.datetime()` true.
 *
 * `price` needs no conversion: the column is `bigint` but the DAO reads it in
 * Drizzle's `mode: 'number'`, so a JS number arrives here and nothing bigint
 * ever reaches `JSON.stringify`, which would throw on one.
 */
const toProductResponse = (row: ProductWithImages): ProductResponse => ({
  id: row.id,
  title: row.title,
  slug: row.slug,
  sku: row.sku,
  brand: row.brand,
  benefit: row.benefit,
  description: row.description,
  price: row.price,
  oldPrice: row.oldPrice,
  stock: row.stock,
  petType: row.petType,
  categoryId: row.categoryId,
  createdAt: row.createdAt.toISOString(),
  images: row.images.map((image) => ({
    id: image.id,
    objectKey: image.objectKey,
    sortOrder: image.sortOrder,
  })),
});

const invalidQueryResponse = {
  content: { 'application/json': { schema: apiErrorSchema } },
  description: 'Query parameters failed validation',
} as const;

export const categoryListRoute = createRoute({
  method: 'get',
  path: '/categories',
  tags: ['catalog'],
  summary: 'List the catalog categories for the nav and the shop filters',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(
            z.array(CategorySchema),
            'CategoryListResponse',
          ),
        },
      },
      description: 'Every category, in the storefront display order',
    },
  },
});

export const categoryListHandler: RouteHandler<
  typeof categoryListRoute
> = async (c) =>
  c.json(apiSuccess((await CategoryDao.list()).map(toCategoryResponse)), 200);

export const productListRoute = createRoute({
  method: 'get',
  path: '/products',
  tags: ['catalog'],
  summary: 'List active products, filtered, sorted and paginated',
  request: { query: ProductListQuerySchema },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(ProductListSchema, 'ProductListResponse'),
        },
      },
      description: 'One page of active products',
    },
    400: invalidQueryResponse,
  },
});

export const productListHandler: RouteHandler<typeof productListRoute> = async (
  c,
) => {
  const { category, pet, sort, minPrice, maxPrice, page, limit } =
    c.req.valid('query');

  const { items, total } = await ProductDao.list({
    categorySlug: category,
    petType: pet,
    minPrice,
    maxPrice,
    sort,
    page,
    limit,
  });

  return c.json(
    apiSuccess({
      items: items.map(toProductResponse),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    }),
    200,
  );
};

export const productDetailRoute = createRoute({
  method: 'get',
  path: '/products/{slug}',
  tags: ['catalog'],
  summary: 'Read one active product with its images',
  request: { params: ProductSlugParamSchema },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: apiSuccessSchema(ProductSchema, 'ProductDetailResponse'),
        },
      },
      description: 'The product',
    },
    400: invalidQueryResponse,
    404: {
      content: { 'application/json': { schema: apiErrorSchema } },
      description:
        'No such product — deliberately the same answer for a slug that never ' +
        'existed and one that was soft-deleted',
    },
  },
});

export const productDetailHandler: RouteHandler<
  typeof productDetailRoute
> = async (c) => {
  const { slug } = c.req.valid('param');

  // `getBySlug` filters on is_active itself, so a hidden product arrives here as
  // null — indistinguishable from a slug nobody ever used, which is the point.
  const product = await ProductDao.getBySlug(slug);
  if (!product) return c.json(apiError(PRODUCT_NOT_FOUND_MESSAGE), 404);

  return c.json(apiSuccess(toProductResponse(product)), 200);
};
