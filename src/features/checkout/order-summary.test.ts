import { describe, expect, it } from 'vitest';
import { toSummaryLines } from './order-summary';

describe('toSummaryLines', () => {
  it('prices each snapshotted item at unit price × quantity', () => {
    expect(
      toSummaryLines([
        { id: 'a', title: 'غذای خشک', qty: 3, unitPrice: 185_000 },
        { id: 'b', title: 'اسباب‌بازی', qty: 1, unitPrice: 0 },
      ]),
    ).toEqual([
      { id: 'a', title: 'غذای خشک', qty: 3, lineTotal: 555_000 },
      { id: 'b', title: 'اسباب‌بازی', qty: 1, lineTotal: 0 },
    ]);
  });

  it('is empty for an order with no items', () => {
    expect(toSummaryLines([])).toEqual([]);
  });
});
