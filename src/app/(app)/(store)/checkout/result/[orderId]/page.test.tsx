// Pins what a card-to-card order's result page shows about its receipt:
// the receipt the checkout uploaded, and nothing to upload or pay with —
// no picker, no card numbers — whether the receipt arrived or not.
//
// The page renders for real; `loadOwnedOrder` is mocked at the module edge.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import { checkoutResumePath } from '@/lib/constant/paths';
import { formatToman } from '@/lib/format';
import {
  COURIER_FEE_TEXT,
  DELIVERY_METHODS,
} from '@/lib/orders/delivery-method';
import type { OwnedOrder } from '@/logic/checkout/get-order';
import {
  acceptedCardToCardOrder,
  waitingCardToCardOrder,
} from '@/logic/checkout/owned-order-test-fixtures';
import ResultPage from './page';

const { loadOwnedOrder } = vi.hoisted(() => ({ loadOwnedOrder: vi.fn() }));
vi.mock('@/features/checkout/load-owned-order', () => ({ loadOwnedOrder }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  loadOwnedOrder.mockReset();
});

const page = async (order: OwnedOrder) => {
  loadOwnedOrder.mockResolvedValue(order);
  return ResultPage({ params: Promise.resolve({ orderId: order.id }) });
};

const box = () =>
  screen.queryByRole('heading', { name: 'رسید پرداخت' })?.closest('section') ??
  null;
const details = () => screen.getByText('شماره سفارش', { exact: true });
/** Whether `first` comes before `second` in the page. */
const precedes = (first: Node | null, second: Node | null) =>
  Boolean(
    first &&
    second &&
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
/** Nothing on the page asks for a receipt or a transfer. */
const expectNothingToUpload = () => {
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(screen.queryByText('بارگذاری رسید')).toBeNull();
  expect(
    screen.queryByText(DEFAULT_CONTENT['checkout.payment'].note),
  ).toBeNull();
  expect(
    screen.queryByText('برای هماهنگی، از طریق', { exact: false }),
  ).toBeNull();
};

describe('the result page of a card-to-card order', () => {
  it('shows no upload box and no card numbers while the receipt has not arrived', async () => {
    render(await page(waitingCardToCardOrder));

    expect(box()).toBeNull();
    expectNothingToUpload();
    // The way back to the one place a receipt is sent: the checkout's retry.
    expect(
      screen.getByRole('link', { name: 'ارسال رسید' }).getAttribute('href'),
    ).toBe(checkoutResumePath(waitingCardToCardOrder.id));
  });

  it('shows the receipt the checkout uploaded, and nothing to upload or pay with', async () => {
    render(await page(acceptedCardToCardOrder));

    expect(precedes(details(), box())).toBe(true);
    expect(box()?.querySelectorAll('img')).toHaveLength(1);
    expectNothingToUpload();
  });
});

describe('the result page and the delivery method', () => {
  it('names post, with the fee, for a post order', async () => {
    render(await page(acceptedCardToCardOrder));

    expect(screen.getByText('روش ارسال')).toBeTruthy();
    expect(screen.getByText('پست')).toBeTruthy();
    expect(screen.getByText(formatToman(25_000))).toBeTruthy();
    expect(screen.queryByText(COURIER_FEE_TEXT)).toBeNull();
  });

  it('names the courier, and the fee as paid on delivery, for a courier order', async () => {
    render(
      await page({
        ...acceptedCardToCardOrder,
        deliveryMethod: DELIVERY_METHODS.COURIER,
        shippingFee: 0,
        total: acceptedCardToCardOrder.subtotal,
      }),
    );

    // Once as the method, once on the summary's shipping row.
    expect(screen.getAllByText('ارسال با پیک')).toHaveLength(2);
    expect(screen.getByText(COURIER_FEE_TEXT)).toBeTruthy();
    expect(screen.queryByText(formatToman(0))).toBeNull();
  });
});

describe("the shopper's note on the order", () => {
  it('shows the note under its heading, line breaks kept', async () => {
    const LF = String.fromCharCode(10);
    render(
      await page({
        ...acceptedCardToCardOrder,
        customerNote: `لطفاً یک روز دیرتر${LF}رنگ آبی`,
      }),
    );

    expect(screen.getByText('توضیحات سفارش')).toBeTruthy();
    const note = screen.getByText(/لطفاً یک روز دیرتر/);
    expect(note.textContent).toBe(`لطفاً یک روز دیرتر${LF}رنگ آبی`);
    expect(note.className).toContain('whitespace-pre-line');
  });

  it('shows nothing about a note when the shopper left none', async () => {
    render(await page(acceptedCardToCardOrder));

    expect(screen.queryByText('توضیحات سفارش')).toBeNull();
  });
});
