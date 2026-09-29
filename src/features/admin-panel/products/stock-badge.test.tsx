// The admin list's stock cell has three branches and a boundary between two of
// them, and the whole reason it moved out of `admin-panel/products/page.tsx` is
// that a component declared inside a route file cannot have a test beside it.
//
// The count is asserted as Persian digits, not Latin ones: `toPersianDigits` is
// part of the render, and «۵» is what an admin actually reads.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { toPersianDigits } from '@/lib/format';
import { StockBadge } from './stock-badge';

afterEach(cleanup);

describe('StockBadge', () => {
  it('reads «ناموجود» at zero, with no count to show', () => {
    render(<StockBadge stock={0} />);

    expect(screen.getByText('ناموجود')).toBeTruthy();
    expect(screen.queryByText(/موجود \(/)).toBeNull();
  });

  it('warns «رو به اتمام» up to and including five', () => {
    render(<StockBadge stock={5} />);

    expect(
      screen.getByText(`رو به اتمام (${toPersianDigits(5)})`),
    ).toBeTruthy();
  });

  it('reads «موجود» one past the low-stock boundary', () => {
    render(<StockBadge stock={6} />);

    expect(screen.getByText(`موجود (${toPersianDigits(6)})`)).toBeTruthy();
  });
});
