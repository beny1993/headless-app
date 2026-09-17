import { describe, expect, it } from 'vitest';
import {
  SUBCATEGORY_PREFIX,
  categoryOptions,
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
      { id: 'hygiene', slug: 'hygiene', label: HYGIENE.title },
      {
        id: 'grooming',
        slug: 'grooming',
        label: `${SUBCATEGORY_PREFIX}${GROOMING.title}`,
      },
      { id: 'food', slug: 'food', label: FOOD.title },
    ]);
  });

  it('answers an empty list with an empty list', () => {
    expect(categoryOptions([])).toEqual([]);
  });
});
