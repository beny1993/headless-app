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
  MAX_SEARCH_TERM_LENGTH,
  productListQueryShape,
  productSlugSchema,
} from '@/lib/catalog/product-query';
import {
  type Category,
  type ProductCard,
  type ProductDetail,
  type ProductWithImages,
} from '@/db/schema/catalog';
import { apiError, apiSuccess, apiSuccessSchema } from '../envelope';
import { errorResponse } from '../route-responses';
import { ProductSchema } from '../product-schema';

/** User-facing copy, so Persian. `errors` stays English developer detail. */
export const PRODUCT_NOT_FOUND_MESSAGE = 'محصول یافت نشد';

const CategorySchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    slug: z.string(),
    sortOrder: z.number().int(),
    /**
     * The category this one sits under; `null` for a top-level one. The list
     * stays flat — consumers nest it with `@/lib/catalog/category-tree`.
     */
    parentId: z.uuid().nullable(),
  })
  .openapi('Category');

/**
 * A listing row: the product plus what its family can be bought for and whether any
 * of it is in stock. A client rendering a grid needs these to print «از …» and
 * to grey out a card; a standalone product reports its own price, no variation
 * and its own stock, so a consumer that ignores families still reads the truth.
 */
const ProductCardSchema = ProductSchema.safeExtend({
  familyMinPrice: z.number().int().positive().meta({
    description:
      'The price to print on the card, integer Toman: the cheapest member a shopper can buy, or the cheapest active member when nothing is in stock. Print this, not `price` — a sold-out head is not a price anyone can buy at.',
  }),
  familyPricesVary: z.boolean(),
  familyInStock: z.boolean(),
  familyHasMembers: z.boolean(),
  familyOpenSlug: z.string().meta({
    description:
      'The slug the card opens: the head while it has stock, else the cheapest member in stock, else the head.',
  }),
}).openapi('ProductCard');

/**
 * One chip on the product page: which sibling it is, what it costs and whether
 * it can be bought. The price is on the chip because the card advertises the
 * family's cheapest buyable price — «از ۱۴۹٬۰۰۰» — and the page it links to has
 * to say which member that is.
 */
const VariantChipSchema = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    label: z.string(),
    isCurrent: z.boolean(),
    /** Integer Toman, this member's own. */
    price: z.number().int().positive(),
    inStock: z.boolean(),
  })
  .openapi('VariantChip');

/**
 * The detail payload: the product plus its family's members, head first, the
 * viewed one marked. Empty when the product has no siblings — including when
 * its only sibling is inactive, since one already-selected chip is no choice.
 */
const ProductDetailSchema = ProductSchema.safeExtend({
  variants: z.array(VariantChipSchema),
}).openapi('ProductDetail');

const ProductListSchema = z
  .object({
    items: z.array(ProductCardSchema),
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
  inStock: productListQueryShape.inStock.meta({
    description:
      'Only products that can be bought: a family counts when a member has stock, and with a price bound that member must be inside it. Case-insensitive `true`, `1`, `yes`, `on`, `y`, `enabled` turn it on; `false`, `0`, `no`, `off`, `n`, `disabled` or absence leave it off; anything else is a 400.',
  }),
  sort: productListQueryShape.sort.meta({
    description:
      'Ordering, applied within in-stock products first and sold-out ones after. Defaults to newest first.',
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
  q: productListQueryShape.q.meta({
    description:
      'Persian search term, matched against the product title, brand and ' +
      'benefit with a trigram index. Sent as typed: Arabic ي/ك, Persian or ' +
      'Arabic-Indic digits and ZWNJ are normalized server-side, so a term ' +
      `typed on an Arabic keyboard matches Persian titles. At most ${MAX_SEARCH_TERM_LENGTH} characters.`,
    example: 'ماگ سرامیکی',
  }),
});

/**
 * Derived from the shared slug schema, not restated — the storefront's product
 * page validates the same visitor input with the same schema. `.meta()` rather
 * than `.openapi()` for the reason spelled out above `ProductListQuerySchema`:
 * a schema built in another module may not carry `.openapi()` at all.
 */
const ProductSlugParamSchema = z.object({
  slug: productSlugSchema.meta({
    param: { name: 'slug', in: 'path' },
    example: 'cat-dry-food',
  }),
});

/** The catalog payloads the storefront renders. Import these, don't restate them. */
export type CategoryResponse = z.infer<typeof CategorySchema>;
export type ProductResponse = z.infer<typeof ProductSchema>;
type ProductCardResponse = z.infer<typeof ProductCardSchema>;
export type ProductDetailResponse = z.infer<typeof ProductDetailSchema>;
export type ProductListResponse = z.infer<typeof ProductListSchema>;
export type ProductListQuery = z.infer<typeof ProductListQuerySchema>;

const toCategoryResponse = (row: Category): CategoryResponse => ({
  id: row.id,
  title: row.title,
  slug: row.slug,
  sortOrder: row.sortOrder,
  parentId: row.parentId,
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
  categoryId: row.categoryId,
  extraCategoryIds: row.extraCategoryIds,
  variantOf: row.variantOf,
  variantLabel: row.variantLabel,
  createdAt: row.createdAt.toISOString(),
  images: row.images.map((image) => ({
    id: image.id,
    objectKey: image.objectKey,
    sortOrder: image.sortOrder,
  })),
});

/** A listing row: the product, plus the facts about its family. */
const toProductCardResponse = (row: ProductCard): ProductCardResponse => ({
  ...toProductResponse(row),
  familyMinPrice: row.familyMinPrice,
  familyPricesVary: row.familyPricesVary,
  familyInStock: row.familyInStock,
  familyHasMembers: row.familyHasMembers,
  familyOpenSlug: row.familyOpenSlug,
});

/** The detail payload: the product, plus its family's chips. */
const toProductDetailResponse = (
  row: ProductDetail,
): ProductDetailResponse => ({
  ...toProductResponse(row),
  // Field by field, like every other mapper here: handing the DAO's array out
  // by reference is the one way a column added to `VariantChip` later would
  // reach an anonymous visitor without appearing in the schema above.
  variants: row.variants.map((variant) => ({
    id: variant.id,
    slug: variant.slug,
    label: variant.label,
    isCurrent: variant.isCurrent,
    price: variant.price,
    inStock: variant.inStock,
  })),
});

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
    400: errorResponse('Query parameters failed validation'),
  },
});

export const productListHandler: RouteHandler<typeof productListRoute> = async (
  c,
) => {
  const { category, inStock, sort, minPrice, maxPrice, page, limit, q } =
    c.req.valid('query');

  const { items, total } = await ProductDao.list({
    categorySlug: category,
    inStock,
    minPrice,
    maxPrice,
    search: q,
    sort,
    page,
    limit,
  });

  return c.json(
    apiSuccess({
      items: items.map(toProductCardResponse),
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
          schema: apiSuccessSchema(
            ProductDetailSchema,
            'ProductDetailResponse',
          ),
        },
      },
      description: 'The product',
    },
    400: errorResponse('Query parameters failed validation'),
    404: errorResponse(
      'No such product — deliberately the same answer for a slug that never ' +
        'existed and one that was soft-deleted',
    ),
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

  return c.json(apiSuccess(toProductDetailResponse(product)), 200);
};
