// Pins the receipt box — the receipts an order's pages show, and nothing to
// upload: the checkout's screenshot is the one way a receipt arrives.
//   · each receipt a plain image through the owner's authenticated route,
//     never `next/image`, numbered for a screen reader, its link saying it
//     opens a new tab;
//   · the pill and the line follow the status it is given;
//   · no picker and no upload button, whatever the status.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { apiOrderReceiptPath } from '@/lib/constant/paths';
import {
  ORDER_STATUS_VALUES,
  ORDER_STATUSES,
  type OrderStatus,
} from '@/lib/orders/order-status';
import { ReceiptBox } from './receipt-box';

afterEach(cleanup);

const ORDER_ID = '11111111-1111-1111-1111-111111111111';
const PREFIX = 'account-order';
// Constructed, never typed: the project's control-character rule.
const ZWNJ = String.fromCharCode(0x200c);
/** What a screen reader hears after a receipt link: it opens a new tab. */
const NEW_TAB = `(در برگه${ZWNJ}ی تازه)`;
const receipt = (n: number) => ({
  id: `2222222${n}-2222-2222-2222-222222222222`,
  uploadedAt: '۸ مهر ۱۴۰۵',
});

const box = (
  status: OrderStatus,
  receipts: { id: string; uploadedAt: string }[] = [receipt(1)],
) => (
  <ReceiptBox
    orderId={ORDER_ID}
    orderStatus={status}
    receipts={receipts}
    eventPrefix={PREFIX}
  />
);

describe('ReceiptBox', () => {
  it('lists each receipt as a plain image through the owner’s route', () => {
    render(box(ORDER_STATUSES.PROCESSING, [receipt(1), receipt(2)]));

    const links = document.querySelectorAll<HTMLAnchorElement>(
      `[data-umami-event="${PREFIX}-receipt-open"]`,
    );
    expect(links).toHaveLength(2);
    const url = apiOrderReceiptPath(ORDER_ID, receipt(1).id);
    expect(links[0].getAttribute('href')).toBe(url);
    expect(links[0].getAttribute('target')).toBe('_blank');
    // Plain <img>, never next/image: the optimizer would cache and re-serve it.
    expect(links[0].querySelector('img')?.getAttribute('src')).toBe(url);
    expect(screen.getByText('دریافت شد؛ در حال بررسی')).toBeTruthy();
    // The pill says where the receipt stands; the page's own copy says what
    // happens next — the box does not repeat it.
    expect(
      screen.queryByText(
        'رسید دریافت شد و سفارش پذیرفته شد؛ پس از بررسی رسید، ارسال می‌شود.',
      ),
    ).toBeNull();
  });

  it('numbers each receipt for a screen reader, and says its link opens a new tab', () => {
    render(box(ORDER_STATUSES.PROCESSING, [receipt(1), receipt(2)]));

    const links = [
      ...document.querySelectorAll<HTMLAnchorElement>(
        `[data-umami-event="${PREFIX}-receipt-open"]`,
      ),
    ];
    // Five receipts named alike are five identical links; Persian digits, as
    // everything a shopper reads.
    expect(
      links.map((link) => link.querySelector('img')?.getAttribute('alt')),
    ).toEqual(['رسید پرداخت ۱', 'رسید پرداخت ۲']);
    for (const link of links) expect(link.textContent).toContain(NEW_TAB);
  });

  it('keeps the receipts of a cancelled order on view, marked rejected', () => {
    render(box(ORDER_STATUSES.CANCELLED, [receipt(1)]));
    expect(screen.getByText('رد شده')).toBeTruthy();
  });

  it.each(ORDER_STATUS_VALUES)(
    'offers nothing to upload on a %s order',
    (status) => {
      render(box(status));
      expect(document.querySelector('input[type="file"]')).toBeNull();
      expect(document.querySelector('button')).toBeNull();
    },
  );
});
