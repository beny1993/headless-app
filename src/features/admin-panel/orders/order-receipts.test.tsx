// What the admin's receipt list says about each receipt. Server-rendered and
// free of hooks, so it renders here as it is, with nothing mocked.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ORDER_STATUSES } from '@/lib/orders/order-status';
import { OrderReceipts } from './order-receipts';

afterEach(cleanup);

const ORDER_ID = '11111111-1111-1111-1111-111111111111';
const receipt = (n: number, createdAt: Date) => ({
  id: `2222222${n}-2222-2222-2222-222222222222`,
  contentType: 'image/jpeg',
  size: 20_000,
  createdAt,
});

describe('OrderReceipts', () => {
  it('says when each receipt came — two from one day are told apart by their Tehran time', () => {
    render(
      <OrderReceipts
        orderId={ORDER_ID}
        status={ORDER_STATUSES.PROCESSING}
        receipts={[
          receipt(1, new Date(Date.UTC(2026, 9, 1, 5, 0))),
          receipt(2, new Date(Date.UTC(2026, 9, 1, 15, 0))),
        ]}
      />,
    );

    expect(screen.getByText('۹ مهر ۱۴۰۵ ساعت ۰۸:۳۰')).toBeTruthy();
    expect(screen.getByText('۹ مهر ۱۴۰۵ ساعت ۱۸:۳۰')).toBeTruthy();
  });
});
