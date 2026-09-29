import { describe, expect, it } from 'vitest';
import {
  SUBCATEGORY_PREFIX,
  categoryOptions,
  homeTiles,
  orderAsTree,
} from './category-tree';

const row = (id: string, parentId: string | null = null) => ({
  id,
  parentId,
  title: `عنوان ${id}`,
  slug: id,
});

const HYGIENE = row('hygiene');
const GROOMING = row('grooming', 'hygiene');
const FOOD = row('food');

describe('orderAsTree', () => {
  it('puts each sub-category straight after its parent, input order kept', () => {
    // The DAO hands rows in storefront order, children among them.
    expect(
      orderAsTree([HYGIENE, FOOD, GROOMING, row('toys')]).map(
        ({ id, depth }) => [id, depth],
      ),
    ).toEqual([
      ['hygiene', 0],
      ['grooming', 1],
      ['food', 0],
      ['toys', 0],
    ]);
  });

  it('keeps sibling sub-categories in the order they arrived', () => {
    const shampoo = row('shampoo', 'hygiene');

    expect(
      orderAsTree([HYGIENE, GROOMING, shampoo]).map(({ id }) => id),
    ).toEqual(['hygiene', 'grooming', 'shampoo']);
  });

  it('emits a row whose parent is absent at the top level, never drops it', () => {
    expect(orderAsTree([GROOMING]).map(({ id, depth }) => [id, depth])).toEqual(
      [['grooming', 0]],
    );
  });

  it('emits a grandchild at the top level — there is only one level', () => {
    const third = row('third', 'grooming');

    expect(
      orderAsTree([HYGIENE, GROOMING, third]).map(({ id, depth }) => [
        id,
        depth,
      ]),
    ).toEqual([
      ['hygiene', 0],
      ['grooming', 1],
      ['third', 0],
    ]);
  });

  it('answers an empty list with an empty list', () => {
    expect(orderAsTree([])).toEqual([]);
  });

  it('carries every field of the row through', () => {
    expect(orderAsTree([GROOMING])[0]).toMatchObject(GROOMING);
  });
});

describe('categoryOptions', () => {
  it('prefixes sub-categories and leaves top-level titles alone', () => {
    expect(categoryOptions([HYGIENE, GROOMING, FOOD])).toEqual([
      {
        id: 'hygiene',
        slug: 'hygiene',
        title: HYGIENE.title,
        label: HYGIENE.title,
      },
      {
        id: 'grooming',
        slug: 'grooming',
        // The plain title rides along: a chip shows it without the prefix.
        title: GROOMING.title,
        label: `${SUBCATEGORY_PREFIX}${GROOMING.title}`,
      },
      { id: 'food', slug: 'food', title: FOOD.title, label: FOOD.title },
    ]);
  });

  it('answers an empty list with an empty list', () => {
    expect(categoryOptions([])).toEqual([]);
  });
});

describe('homeTiles', () => {
  // Eight main categories, already in display order.
  const MAIN = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => row(id));
  const ids = (tiles: { id: string }[]) => tiles.map((tile) => tile.id);

  it('shows the first six in display order while nothing is picked', () => {
    expect(ids(homeTiles(MAIN, undefined))).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
    ]);
  });

  it('puts the picks first, in the order picked, and fills the rest in display order', () => {
    expect(ids(homeTiles(MAIN, ['g', 'b']))).toEqual([
      'g',
      'b',
      'a',
      'c',
      'd',
      'e',
    ]);
  });

  it('drops a pick the list no longer holds, and the next category takes its place', () => {
    // Deleted since, or made a sub-category: either way not a main category.
    expect(ids(homeTiles(MAIN, ['gone', 'c']))).toEqual([
      'c',
      'a',
      'b',
      'd',
      'e',
      'f',
    ]);
  });

  it('shows every category when the shop has fewer than six', () => {
    expect(ids(homeTiles(MAIN.slice(0, 3), ['c']))).toEqual(['c', 'a', 'b']);
  });
});
