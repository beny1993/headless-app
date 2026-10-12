// The shop's streaming contract (`Story - Storefront Caching and Streaming`):
// the heading, search and filters render without waiting for the listing,
// which streams in behind `ShopShelfSkeleton`. One `await` of the listing in
// the page would hold the whole shell until the query lands, and nothing else
// would notice: the E2E can only prove the boundary exists
// (`e2e/streaming.spec.ts`), and a fast local database hides the wait.
//
// So the listing never settles here. The page must still return, and hand that
// same promise to the shelf inside a Suspense boundary whose fallback is the
// skeleton. The DAO and the cached reads are mocked at the module edge; the
// page and `parseShopQuery` run for real.
import { Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SHOP_TITLE } from '@/features/storefront/shop/shop-metadata';
import {
  ShopShelf,
  ShopShelfSkeleton,
} from '@/features/storefront/shop/shop-shelf';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/db/dao/ProductDao', () => ({ ProductDao: { list: mocks.list } }));
vi.mock('@/logic/storefront/cached-reads', () => ({
  storefrontCategories: async () => [],
  storefrontPriceBounds: async () => ({ min: 0, max: 1_000_000 }),
}));

const { default: ShopPage } = await import('./page');

type El = { type?: unknown; props?: Record<string, unknown> };

/** Every element in a rendered tree, depth first. */
function* elements(node: unknown): Generator<El> {
  if (Array.isArray(node)) {
    for (const child of node) yield* elements(child);
  } else if (typeof node === 'object' && node !== null && 'props' in node) {
    yield node as El;
    yield* elements((node as El).props?.children);
  }
}

const STILL_WAITING = Symbol('still waiting');

describe('the shop page', () => {
  it('renders without waiting for the listing, handing it to the shelf behind the skeleton', async () => {
    const listing = new Promise<never>(() => {});
    mocks.list.mockReturnValue(listing);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const page = await Promise.race([
      ShopPage({ searchParams: Promise.resolve({}) }),
      new Promise<typeof STILL_WAITING>((resolve) => {
        timer = setTimeout(() => resolve(STILL_WAITING), 2000);
      }),
    ]).finally(() => clearTimeout(timer));

    expect(page).not.toBe(STILL_WAITING);
    const tree = [...elements(page)];
    expect(tree.find((el) => el.type === 'h1')?.props?.children).toBe(
      SHOP_TITLE,
    );
    const boundary = tree.find((el) => el.type === Suspense);
    expect(boundary?.props?.fallback).toMatchObject({
      type: ShopShelfSkeleton,
    });
    const shelf = boundary?.props?.children as El | undefined;
    expect(shelf?.type).toBe(ShopShelf);
    // The very read the page started, by identity: nothing awaited it first.
    expect(shelf?.props?.listing).toBe(listing);
  });
});
