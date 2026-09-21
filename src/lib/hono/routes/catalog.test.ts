// Query validation only — no database needed. Every request here is rejected by
// the router's `defaultHook` before a handler runs, so a stubbed `@/db` is never
// dereferenced. `@/db` still has to be mocked: importing the app now pulls in
// the catalog routes, which reach the DAOs, and `@/db` throws at import when
// APP_CONFIG_DATABASE_URL is unset.
//
// The behaviour of the routes themselves is covered against a real Postgres in
// ./catalog.integration.test.ts.
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PRODUCT_PAGE_SIZE,
  MAX_PRODUCT_PAGE_SIZE,
  MAX_SEARCH_TERM_LENGTH,
  PET_TYPES,
  PRODUCT_SORTS,
} from '@/lib/catalog/product-query';
import { API_PATHS } from '@/lib/constant/paths';
import type { ApiError } from '@/lib/hono/envelope';

vi.mock('@/db', () => ({ db: {} }));

const { app } = await import('@/lib/hono');

const rejects = async (query: string) => {
  const response = await app.request(`${API_PATHS.PRODUCTS}?${query}`);
  return { status: response.status, body: (await response.json()) as ApiError };
};

describe('GET /api/products — query validation', () => {
  it.each([
    ['page below one', 'page=0'],
    ['a negative page', 'page=-1'],
    ['a fractional page', 'page=1.5'],
    ['a page that is not a number', 'page=abc'],
    ['an empty page', 'page='],
    // Above the safe-integer range the page number stops being exact, and the
    // offset built from it stops meaning anything. Zod draws that line; this
    // pins that it stays drawn.
    ['a page past the safe integer range', 'page=99999999999999999999'],
    ['a page in exponent notation past that range', 'page=1e20'],
    ['limit below one', 'limit=0'],
    ['a limit over the cap', 'limit=49'],
    ['a limit that is not a number', 'limit=abc'],
    ['an unknown sort', 'sort=cheapest'],
    ['an unknown pet type', 'pet=hamster'],
    ['a negative minimum price', 'minPrice=-1'],
    ['a fractional minimum price', 'minPrice=10.5'],
    ['a minimum price that is not a number', 'minPrice=abc'],
    ['a negative maximum price', 'maxPrice=-1'],
    ['a maximum price that is not a number', 'maxPrice=abc'],
    ['an empty category slug', 'category='],
    // `Number('')` is 0 and `price > 0` is a CHECK constraint, so an empty
    // maximum used to mean "at most zero Toman" — every product filtered out,
    // reported as a successful empty shop. An empty filter field is the way a
    // storefront produces this, so it has to be the loud answer.
    ['an empty maximum price', 'maxPrice='],
    ['a whitespace maximum price', 'maxPrice=%20'],
    ['a maximum price of zero, which no product can satisfy', 'maxPrice=0'],
    // An empty `q` is the parameter a submitted-but-blank search box leaves
    // behind. The API is the strict side of the contract and says so; the shop
    // page drops a blank term before it ever gets here.
    ['an empty search term', 'q='],
    // The cap is not politeness. Every extra character is more trigrams to
    // match against every row, and a search box is the cheapest place on the
    // site to hand a stranger that multiplier.
    [
      'a search term one character over the cap',
      `q=${encodeURIComponent('گ'.repeat(MAX_SEARCH_TERM_LENGTH + 1))}`,
    ],
  ])('rejects %s', async (_label, query) => {
    const { status, body } = await rejects(query);

    expect(status).toBe(400);
    expect(body.status).toBe('error');
  });

  it('answers a rejected query in Persian, the language the site speaks', async () => {
    const { body } = await rejects('page=0');

    expect(body.message).toBe('ورودی نامعتبر است');
  });

  it('names the offending parameter in the developer detail', async () => {
    // `message` is user copy; `errors` is for whoever is reading the response in
    // a console. It must say which parameter was wrong, or a broken FE query
    // string is undebuggable.
    const { body } = await rejects('limit=49');

    expect(body.errors?.join(' ')).toContain('limit');
  });

  it('reports every bad parameter at once rather than only the first', async () => {
    const { body } = await rejects('page=0&limit=99&sort=nope');

    const detail = body.errors?.join(' ') ?? '';
    expect(detail).toContain('page');
    expect(detail).toContain('limit');
    expect(detail).toContain('sort');
  });

  it('never leaks a data field on the error branch', async () => {
    const { body } = await rejects('page=0');

    expect(body).not.toHaveProperty('data');
  });

  it.each([
    ['the pet types the schema names', 'pet=cat'],
    ['the other pet type', 'pet=dog'],
    ['every sort the storefront offers', 'sort=newest'],
    ['ascending price', 'sort=price-asc'],
    ['descending price', 'sort=price-desc'],
    ['the maximum allowed limit', `limit=48`],
    ['a zero minimum price', 'minPrice=0'],
    // The counterpart of the rejected empty maximum: zero *is* the natural
    // floor, so an empty minimum is a no-op rather than a contradiction.
    ['an empty minimum price, which is simply no floor', 'minPrice='],
    ['a page at the top of the safe integer range', 'page=9007199254740991'],
    ['an inverted price range', 'minPrice=900000&maxPrice=1'],
    ['a Persian search term', `q=${encodeURIComponent('غذای خشک')}`],
    [
      'a search term typed on an Arabic keyboard',
      `q=${encodeURIComponent('غذاي خشك')}`,
    ],
    ['a one-character search term', `q=${encodeURIComponent('گ')}`],
    [
      'a search term exactly at the length cap',
      `q=${encodeURIComponent('گ'.repeat(MAX_SEARCH_TERM_LENGTH))}`,
    ],
  ])('accepts %s', async (_label, query) => {
    // Accepted means "past validation": the stubbed db then fails the handler
    // with a 500. Anything but 400 proves the query itself was legal.
    const { status } = await rejects(query);

    expect(status).not.toBe(400);
  });
});

// The query schema is built from the shared field shapes in
// `@/lib/catalog/product-query` and documented here with `.meta()`. Both halves
// are worth pinning: `.openapi()` cannot be used on those shared fields (zod 4
// only grafts it onto schemas built after `@hono/zod-openapi` loads, which made
// the doc depend on module evaluation order), and a silent loss of the
// descriptions is exactly what this replacement could regress into.
describe('GET /api/products — generated documentation', () => {
  const parameters = async () => {
    const doc = (await (await app.request(API_PATHS.DOC)).json()) as {
      paths: Record<
        string,
        {
          get: {
            parameters: {
              name: string;
              description?: string;
              schema: Record<string, unknown>;
            }[];
          };
        }
      >;
    };

    return new Map(
      doc.paths[API_PATHS.PRODUCTS].get.parameters.map((p) => [p.name, p]),
    );
  };

  it('describes every query parameter it accepts', async () => {
    const params = await parameters();

    for (const name of [
      'category',
      'pet',
      'sort',
      'minPrice',
      'maxPrice',
      'page',
      'limit',
      'q',
    ]) {
      expect(params.get(name)?.description ?? '').not.toBe('');
    }
  });

  it('publishes the bounds it actually enforces', async () => {
    // These come from the shared shape, not from anything written in this file
    // — if the split ever stops reaching the document, the contract published
    // to clients would quietly stop matching the one enforced on requests.
    const params = await parameters();

    expect(params.get('limit')?.schema).toMatchObject({
      maximum: MAX_PRODUCT_PAGE_SIZE,
      default: DEFAULT_PRODUCT_PAGE_SIZE,
      minimum: 1,
    });
    expect(params.get('sort')?.schema).toMatchObject({
      enum: Object.values(PRODUCT_SORTS),
      default: PRODUCT_SORTS.NEWEST,
    });
    expect(params.get('pet')?.schema).toMatchObject({
      enum: Object.values(PET_TYPES),
    });
    expect(params.get('q')?.schema).toMatchObject({
      maxLength: MAX_SEARCH_TERM_LENGTH,
      minLength: 1,
    });
  });
});

// The detail route's path parameter is derived from `productSlugSchema`, which
// the storefront's product page validates the same visitor input with. The
// derivation goes through `.meta()` for the reason above, and a `.meta()` the
// generator stops reading would drop the parameter from the document without
// failing a single request test.
describe('GET /api/products/{slug} — generated documentation', () => {
  it('documents the slug path parameter, bounds included', async () => {
    const doc = (await (await app.request(API_PATHS.DOC)).json()) as {
      paths: Record<string, { get: { parameters: Record<string, unknown>[] } }>;
    };

    expect(
      // Spelled out: the point is the path the route registers (see app.test.ts).
      doc.paths['/api/products/{slug}'].get.parameters,
    ).toContainEqual(
      expect.objectContaining({
        name: 'slug',
        in: 'path',
        required: true,
        schema: expect.objectContaining({ type: 'string', minLength: 1 }),
      }),
    );
  });
});

// A null byte is the one character Postgres refuses inside a text parameter -
// the driver throws and an unhandled throw answers 500. The schemas strip it,
// so such input reads as text that simply matches nothing (404 for a slug, an
// empty listing for a filter) instead of a server error. Pure schema tests
// here; the end-to-end 404 lives in ./catalog.integration.test.ts.
// NUL is built with String.fromCharCode so no literal control byte sits in
// this source file.
const NUL = String.fromCharCode(0);

describe('null bytes in text inputs', () => {
  it('strips U+0000 from a slug so the lookup misses instead of throwing', async () => {
    const { productSlugSchema } = await import('@/lib/catalog/product-query');
    expect(productSlugSchema.parse(`abc${NUL}def`)).toBe('abcdef');
    expect(productSlugSchema.parse(NUL)).toBe('');
  });

  it('strips U+0000 from the category filter', async () => {
    const { productListQuerySchema } =
      await import('@/lib/catalog/product-query');
    expect(
      productListQuerySchema.parse({ category: `a${NUL}b` }).category,
    ).toBe('ab');
  });

  it('strips U+0000 from the search term', async () => {
    // `q` reaches Postgres as a trigram operand, so it is in exactly the same
    // class as the slug and the category slug: it inherits the strip rather
    // than carrying a rule of its own.
    const { productListQuerySchema } =
      await import('@/lib/catalog/product-query');
    expect(productListQuerySchema.parse({ q: `غذا${NUL}` }).q).toBe('غذا');
  });

  it('leaves a search term of nothing but null bytes as an empty term', async () => {
    // `.min(1)` runs before the strip, so this passes validation and arrives
    // empty — which the DAO reads as no search at all, the same answer an
    // absent `q` gets. An empty listing would be a lie; a full one is honest.
    const { productListQuerySchema } =
      await import('@/lib/catalog/product-query');
    expect(productListQuerySchema.parse({ q: NUL }).q).toBe('');
  });
});
