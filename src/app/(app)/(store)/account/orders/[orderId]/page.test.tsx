// Pins what a card-to-card order's account order page shows about its receipt:
// the receipt the checkout uploaded, and nothing to upload or pay with —
// no picker, no card numbers — whether the receipt arrived or not.
//
// The page renders for real; `loadOwnedOrder` is mocked at the module edge.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import type { OwnedOrder } from '@/logic/checkout/get-order';
import {
  acceptedCardToCardOrder,
  waitingCardToCardOrder,
} from '@/logic/checkout/owned-order-test-fixtures';
import AccountOrderPage from './page';

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
  return AccountOrderPage({ params: Promise.resolve({ orderId: order.id }) });
};

const box = () =>
  screen.queryByRole('heading', { name: 'رسید پرداخت' })?.closest('section') ??
  null;
const details = () => screen.getByRole('heading', { name: 'اقلام سفارش' });
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

describe('the account page of a card-to-card order', () => {
  it('shows no upload box and no card numbers while the receipt has not arrived', async () => {
    render(await page(waitingCardToCardOrder));

    expect(box()).toBeNull();
    expectNothingToUpload();
  });

  it('shows the receipt the checkout uploaded, and nothing to upload or pay with', async () => {
    render(await page(acceptedCardToCardOrder));

    expect(precedes(details(), box())).toBe(false);
    expect(box()?.querySelectorAll('img')).toHaveLength(1);
    expectNothingToUpload();
  });
});
