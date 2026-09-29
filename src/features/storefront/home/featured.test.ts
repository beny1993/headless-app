import { describe, expect, it } from 'vitest';
import { selectFeatured } from '@/features/storefront/home/featured';
import { FEATURED_COUNT } from '@/lib/content/site-content';

/**
 * The fields the selection reads; the id marks order and what counts as a
 * repeat. A standalone product's own stock is its family's.
 */
const product = (
  id: string,
  inStock = true,
  oldPrice: number | null = null,
) => ({
  id,
  stock: inStock ? 5 : 0,
  familyInStock: inStock,
  oldPrice,
});

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

describe('selectFeatured', () => {
  it('never features a product nobody can buy', () => {
    const picked = selectFeatured([
      product('sold-out', false),
      product('in-stock'),
    ]);

    expect(ids(picked)).toEqual(['in-stock']);
  });

  it('reads the family’s stock: a sold-out head whose other size is on the shelf still features', () => {
    // The card greys out on `familyInStock`, so the rule must read the same
    // fact — the head's own `stock` would drop a family the card still sells.
    const head = { ...product('family'), stock: 0 };

    expect(ids(selectFeatured([head]))).toEqual(['family']);
  });

  it('leads with the discounted products', () => {
    const picked = selectFeatured([
      product('plain-1'),
      product('deal', true, 200_000),
      product('plain-2'),
    ]);

    expect(ids(picked)).toEqual(['deal', 'plain-1', 'plain-2']);
  });

  it('does not lead with a discount nobody can buy: a sold-out discounted head keeps its catalog place', () => {
    // The family is on the shelf through its other size, so it features — but
    // the discounted row itself is sold out, so it is no deal.
    const head = { ...product('family', true, 200_000), stock: 0 };

    const picked = selectFeatured([
      product('plain-1'),
      head,
      product('plain-2'),
    ]);

    expect(ids(picked)).toEqual(['plain-1', 'family', 'plain-2']);
  });

  it('keeps the incoming order inside each group', () => {
    // The DAO hands them over newest-first; the only reordering allowed is
    // pulling the discounts forward, so two deals stay in catalog order.
    const picked = selectFeatured([
      product('deal-a', true, 1),
      product('plain-a'),
      product('deal-b', true, 1),
      product('plain-b'),
    ]);

    expect(ids(picked)).toEqual(['deal-a', 'deal-b', 'plain-a', 'plain-b']);
  });

  it('fills the grid’s boxes and no more', () => {
    const picked = selectFeatured(
      Array.from({ length: 10 }, (_, i) => product(`p${i}`)),
    );

    expect(picked).toHaveLength(FEATURED_COUNT);
    expect(FEATURED_COUNT).toBe(4);
  });

  it('returns what it has when the catalog is smaller than the grid', () => {
    expect(ids(selectFeatured([product('only')]))).toEqual(['only']);
  });

  it('returns nothing for an empty catalog or an all-sold-out one', () => {
    // The home page renders its own "nothing to show" copy — it must never be
    // handed a padded list of unavailable products instead.
    expect(selectFeatured([])).toEqual([]);
    expect(
      selectFeatured([product('a', false), product('b', false, 5)]),
    ).toEqual([]);
  });

  describe('the admin’s picks', () => {
    it('puts each pick in its own box and fills the boxes left on «خودکار» from the rule', () => {
      const catalog = [product('plain'), product('deal', true, 1)];

      const picked = selectFeatured(catalog, [
        undefined,
        product('pick-2'),
        undefined,
        product('pick-4'),
      ]);

      expect(ids(picked)).toEqual(['deal', 'pick-2', 'plain', 'pick-4']);
    });

    it('never shows a product twice: a pick is not offered again by the rule', () => {
      // `deal` would lead the automatic boxes; picked into box three, it
      // shows there and nowhere else.
      const catalog = [product('deal', true, 1), product('plain')];

      const picked = selectFeatured(catalog, [
        undefined,
        undefined,
        product('deal', true, 1),
      ]);

      expect(ids(picked)).toEqual(['plain', 'deal']);
    });

    it('fills a sold-out pick’s box from the rule instead of leading with a dead card', () => {
      const picked = selectFeatured(
        [product('plain')],
        [product('sold-out', false)],
      );

      expect(ids(picked)).toEqual(['plain']);
    });

    it('shows every pick even when the rule has nothing left to offer', () => {
      // The picks come from their own query: they need not be in `products`.
      const picks = ['a', 'b', 'c', 'd'].map((id) => product(id));

      expect(ids(selectFeatured([], picks))).toEqual(['a', 'b', 'c', 'd']);
      expect(ids(selectFeatured([], [product('a')]))).toEqual(['a']);
    });

    it('shows no pick past the grid’s last box', () => {
      const picks = ['a', 'b', 'c', 'd', 'e'].map((id) => product(id));

      expect(ids(selectFeatured([], picks))).toEqual(['a', 'b', 'c', 'd']);
    });
  });

  it('does not mutate or reorder the caller’s arrays', () => {
    const rows = [product('plain'), product('deal', true, 1)];
    const picks = [undefined, product('pick')];
    const snapshot = { rows: ids(rows), picks: [...picks] };

    selectFeatured(rows, picks);

    expect(ids(rows)).toEqual(snapshot.rows);
    expect(picks).toEqual(snapshot.picks);
  });
});
