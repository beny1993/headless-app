// Pins where a card-to-card order's receipt box sits on the account order
// page, and that it is one mounted component whichever place it is in:
//   · waiting for its receipt, the box comes first, before the card numbers,
//     so the shopper finds it without scrolling;
//   · accepted, the card numbers come first again, and it is the same box
//     moved below them, not a new one mounted, so it keeps its state across
//     the `router.refresh()` that moved it.
//
// The page renders for real; `loadOwnedOrder` and the content read are mocked
// at the module edge, and `next/navigation` for the box's `useRouter`.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import type { OwnedOrder } from '@/logic/checkout/get-order';
import {
  acceptedCardToCardOrder,
  waitingCardToCardOrder,
} from '@/logic/checkout/get-order.fixture';
import AccountOrderPage from './page';

const { loadOwnedOrder } = vi.hoisted(() => ({ loadOwnedOrder: vi.fn() }));
vi.mock('@/features/checkout/load-owned-order', () => ({
  loadOwnedOrder,
  readCardToCardPayment: async () => DEFAULT_CONTENT['checkout.payment'],
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  loadOwnedOrder.mockReset();
});

const page = async (order: OwnedOrder) => {
  loadOwnedOrder.mockResolvedValue(order);
  return AccountOrderPage({ params: Promise.resolve({ orderId: order.id }) });
};

const box = () =>
  screen.getByRole('heading', { name: 'رسید پرداخت' }).closest('section');
const cardNumbers = () =>
  screen.getByText(DEFAULT_CONTENT['checkout.payment'].note);
const items = () => screen.getByRole('heading', { name: 'اقلام سفارش' });
/** Whether `first` comes before `second` in the page. */
const precedes = (first: Node | null, second: Node | null) =>
  Boolean(
    first &&
    second &&
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );

describe('the account page of a card-to-card order', () => {
  it('puts the receipt box first while the order waits, after the not-accepted banner', async () => {
    render(await page(waitingCardToCardOrder));

    expect(
      precedes(screen.getByText('سفارش هنوز پذیرفته نشده است'), box()),
    ).toBe(true);
    expect(precedes(box(), cardNumbers())).toBe(true);
    expect(precedes(cardNumbers(), items())).toBe(true);
  });

  it('moves that same box below the card numbers once the order is accepted', async () => {
    const view = render(await page(waitingCardToCardOrder));
    const mounted = box();

    view.rerender(await page(acceptedCardToCardOrder));

    expect(box()).toBe(mounted);
    expect(precedes(cardNumbers(), box())).toBe(true);
    expect(precedes(box(), items())).toBe(true);
  });
});
