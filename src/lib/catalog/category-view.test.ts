import { describe, expect, it } from 'vitest';
import type { Category } from '@/db/schema/catalog';
import { toCategoryView } from '@/lib/catalog/category-view';

// The admin category projection: what every admin category route returns, and
// what the manager page renders its first paint from.
describe('toCategoryView', () => {
  const row: Category = {
    id: '55555555-5555-4555-8555-555555555555',
    title: 'غذای خشک',
    slug: 'dry-food',
    sortOrder: 2,
    parentId: null,
    imageKey: null,
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-15T09:00:00.000Z'),
  };

  it('ISOs both timestamps and keeps a top-level category parentless', () => {
    expect(toCategoryView(row)).toEqual({
      id: '55555555-5555-4555-8555-555555555555',
      title: 'غذای خشک',
      slug: 'dry-food',
      sortOrder: 2,
      parentId: null,
      imageKey: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-15T09:00:00.000Z',
    });
  });

  it('carries a sub-category’s parent through', () => {
    const parentId = '66666666-6666-4666-8666-666666666666';
    expect(toCategoryView({ ...row, parentId }).parentId).toBe(parentId);
  });

  it('carries the photo’s storage key through, never a URL', () => {
    const imageKey = 'uploads/123e4567-e89b-42d3-a456-426614174000.webp';
    expect(toCategoryView({ ...row, imageKey }).imageKey).toBe(imageKey);
  });
});
