// When the admin list offers 🗑 (AC-6): always on an active product, and on an
// inactive one only when it can really be deleted — an inactive product with
// orders or members has nothing left to deactivate, so it shows nothing.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductWithImages } from '@/db/schema/catalog';
import {
  HARD_DELETE_BLOCKERS,
  type HardDeleteBlocker,
} from '@/lib/catalog/product-delete';
import { ProductRow } from './product-row';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

const TITLE = 'غذای گربه';

/** The columns the row reads; the rest of a product is noise here. */
const product = (isActive: boolean) =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    title: TITLE,
    slug: 'cat-food',
    brand: null,
    price: 100_000,
    stock: 3,
    isActive,
    variantLabel: null,
    variantOf: null,
    images: [],
  }) as unknown as ProductWithImages;

const renderRow = (isActive: boolean, blocker: HardDeleteBlocker | null) =>
  render(
    <table>
      <tbody>
        <ProductRow
          product={product(isActive)}
          categoryTitle="غذا"
          rowNumber={1}
          deleteBlocker={blocker}
        />
      </tbody>
    </table>,
  );

const trash = () => screen.queryByRole('button', { name: `حذف ${TITLE}` });

describe('ProductRow — the 🗑', () => {
  it.each([null, HARD_DELETE_BLOCKERS.ORDERS, HARD_DELETE_BLOCKERS.MEMBERS])(
    'is offered on an active product (blocker %s)',
    (blocker) => {
      renderRow(true, blocker);
      expect(trash()).not.toBeNull();
    },
  );

  it('is offered on an inactive product nothing references', () => {
    renderRow(false, null);
    expect(trash()).not.toBeNull();
  });

  it.each([HARD_DELETE_BLOCKERS.ORDERS, HARD_DELETE_BLOCKERS.MEMBERS])(
    'is not offered on an inactive product with %s',
    (blocker) => {
      renderRow(false, blocker);
      expect(trash()).toBeNull();
    },
  );
});
