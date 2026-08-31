// Query validation only — no database needed. Every request here is rejected by
// the router's `defaultHook` before a handler runs, so a stubbed `@/db` is never
// dereferenced. `@/db` still has to be mocked: importing the app now pulls in
// the catalog routes, which reach the DAOs, and `@/db` throws at import when
// APP_CONFIG_DATABASE_URL is unset.
//
// The behaviour of the routes themselves is covered against a real Postgres in
// ./catalog.integration.test.ts.
import { describe, expect, it, vi } from 'vitest';
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
