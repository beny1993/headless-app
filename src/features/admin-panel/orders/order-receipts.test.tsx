// What the admin's receipt list says about each receipt. Server-rendered and
// free of hooks, so it renders here as it is, with nothing mocked.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ORDER_STATUSES } from '@/lib/orders/order-status';
import { OrderReceipts } from './order-receipts';

afterEach(cleanup);

const ORDER_ID = '11111111-1111-1111-1111-111111111111';
// Constructed, never typed: the project's control-character rule.
const NEW_TAB = `(در برگه${String.fromCharCode(0x200c)}ی تازه)`;
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

  it('numbers each receipt for a screen reader, and says its link opens a new tab', () => {
    render(
      <OrderReceipts
        orderId={ORDER_ID}
        status={ORDER_STATUSES.PROCESSING}
        receipts={[1, 2].map((n) => receipt(n, new Date(0)))}
      />,
    );

    const links = [
      ...document.querySelectorAll<HTMLAnchorElement>(
        '[data-umami-event="admin-panel-order-receipt-open"]',
      ),
    ];
    expect(
      links.map((link) => link.querySelector('img')?.getAttribute('alt')),
    ).toEqual(['رسید پرداخت ۱', 'رسید پرداخت ۲']);
    for (const link of links) expect(link.textContent).toContain(NEW_TAB);
  });
});
