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
  });
});
