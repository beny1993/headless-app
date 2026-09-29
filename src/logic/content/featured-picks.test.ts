// Which picks the home page reads, and how often — the DAO is mocked at its
// edge; what a card IS (active, one per family) is proven against a real
// database by `ProductDao.cardsByIds`'s own suite.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductCard } from '@/db/schema/catalog';

const { cardsByIds } = vi.hoisted(() => ({ cardsByIds: vi.fn() }));
vi.mock('@/db/dao/ProductDao', () => ({ ProductDao: { cardsByIds } }));

import { loadFeaturedPicks } from './featured-picks';

const card = (id: string) => ({ id }) as ProductCard;
/** Every id the picks were read by, across every call. */
const asked = () => cardsByIds.mock.calls.flatMap(([ids]) => ids);

describe('loadFeaturedPicks', () => {
  beforeEach(() => {
    cardsByIds.mockReset();
    cardsByIds.mockResolvedValue([]);
  });

  it('reads nothing when no box is picked', async () => {
    expect(await loadFeaturedPicks(undefined, [card('a')])).toEqual([]);
    expect(await loadFeaturedPicks([null, null], [card('a')])).toEqual([
      undefined,
      undefined,
    ]);
    expect(asked()).toEqual([]);
  });

  it('takes a pick already on the listing page from there, without reading it again', async () => {
    const onPage = card('on-page');

    expect(
      await loadFeaturedPicks([null, 'on-page'], [card('x'), onPage]),
    ).toEqual([undefined, onPage]);
    expect(asked()).toEqual([]);
  });

  it('reads only the picks not already listed, in one call, and keeps the box order', async () => {
    const onPage = card('on-page');
    const older = card('older');
    cardsByIds.mockResolvedValue([older]);

    expect(
      await loadFeaturedPicks(['older', null, 'on-page'], [onPage]),
    ).toEqual([older, undefined, onPage]);
    expect(cardsByIds).toHaveBeenCalledTimes(1);
    expect(asked()).toEqual(['older']);
  });

  it('leaves a box empty when its pick is no longer a listed card', async () => {
    expect(await loadFeaturedPicks(['gone'], [])).toEqual([undefined]);
    expect(asked()).toEqual(['gone']);
  });
});
