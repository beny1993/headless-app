import { describe, expect, it } from 'vitest';
import {
  FEATURED_COUNT,
  selectFeatured,
} from '@/features/storefront/home/featured';

/** The two fields the selection reads, plus a marker so order is assertable. */
const product = (
  id: string,
  stock: number,
  oldPrice: number | null = null,
) => ({
  id,
  stock,
  oldPrice,
});

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

describe('selectFeatured', () => {
  it('never features a product nobody can buy', () => {
    const picked = selectFeatured([
      product('sold-out', 0),
      product('in-stock', 1),
    ]);

    expect(ids(picked)).toEqual(['in-stock']);
  });

  it('leads with the discounted products', () => {
    const picked = selectFeatured([
      product('plain-1', 5),
      product('deal', 5, 200_000),
      product('plain-2', 5),
    ]);

    expect(ids(picked)).toEqual(['deal', 'plain-1', 'plain-2']);
  });

  it('keeps the incoming order inside each group', () => {
    // The DAO hands them over newest-first; the only reordering allowed is
    // pulling the discounts forward, so two deals stay in catalog order.
    const picked = selectFeatured([
      product('deal-a', 5, 1),
      product('plain-a', 5),
      product('deal-b', 5, 1),
      product('plain-b', 5),
    ]);

    expect(ids(picked)).toEqual(['deal-a', 'deal-b', 'plain-a', 'plain-b']);
  });

  it('takes four by default', () => {
    const picked = selectFeatured(
      Array.from({ length: 10 }, (_, i) => product(`p${i}`, 5)),
    );

    expect(picked).toHaveLength(FEATURED_COUNT);
    expect(FEATURED_COUNT).toBe(4);
  });

  it('honours an explicit count', () => {
    const rows = Array.from({ length: 10 }, (_, i) => product(`p${i}`, 5));

    expect(selectFeatured(rows, 2)).toHaveLength(2);
    expect(selectFeatured(rows, 0)).toHaveLength(0);
    // A negative count is a caller bug; it must not slice from the end.
    expect(selectFeatured(rows, -3)).toHaveLength(0);
  });

  it('returns what it has when the catalog is smaller than the count', () => {
    expect(ids(selectFeatured([product('only', 5)]))).toEqual(['only']);
  });

  it('returns nothing for an empty catalog or an all-sold-out one', () => {
    // The home page renders its own "nothing to show" copy — it must never be
    // handed a padded list of unavailable products instead.
    expect(selectFeatured([])).toEqual([]);
    expect(selectFeatured([product('a', 0), product('b', 0, 5)])).toEqual([]);
  });

  it('treats a negative stock as unavailable', () => {
    // A CHECK constraint forbids it in the database, but the function is the
    // last place this is cheap to be sure about.
    expect(selectFeatured([product('corrupt', -1)])).toEqual([]);
  });

  it('does not mutate or reorder the caller’s array', () => {
    const rows = [product('plain', 5), product('deal', 5, 1)];
    const snapshot = ids(rows);

    selectFeatured(rows);

    expect(ids(rows)).toEqual(snapshot);
  });
});
