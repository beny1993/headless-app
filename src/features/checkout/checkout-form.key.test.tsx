// Pins which Idempotency-Key a checkout create carries. The server hands back
// the order a known key already made, whatever body comes with it
// (`createOrder`'s replay), so the key travels with the exact body it was
// minted for:
//   · a create whose answer was lost is resent with the same key after a
//     reload — the form mounted afresh — so it gets that order back instead of
//     placing a second one;
//   · a different body is a different checkout and gets a fresh key, or the
//     server would answer it with the old order;
//   · an order created consumes its key: buying the same cart again later is a
//     new order;
//   · a key kept over half an hour is not resent;
//   · storage that throws leaves the key in memory, as before.
//
// Mocked at the module edge only: `next/navigation` and `@/lib/api-client`'s
// `postData` and `postForm`. The cart store and `sessionStorage` (happy-dom's)
// run for real.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutForm } from './checkout-form';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import {
  addToCart,
  clearCart,
  type CartLineInput,
} from '@/features/storefront/cart/cart';
import { ApiRequestError } from '@/lib/api-client';
import { API_PATHS } from '@/lib/constant/paths';

const { push, replace } = vi.hoisted(() => ({
  push: vi.fn<(href: string) => void>(),
  replace: vi.fn<(href: string) => void>(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
}));

const { postData, postForm } = vi.hoisted(() => ({
  postData: vi.fn(),
  postForm: vi.fn(),
}));
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  postData,
  postForm,
}));

const RATES = [{ provinceId: 1, name: 'تهران', fee: 40_000 }];
const CAT_TOY: CartLineInput = {
  productId: 'p1',
  slug: 'cat-toy',
  title: 'اسباب‌بازی گربه',
  sku: 'SKU-1',
  unitPrice: 185_000,
};
const CAT_FOOD: CartLineInput = {
  productId: 'p2',
  slug: 'cat-food',
  title: 'غذای گربه',
  sku: 'SKU-2',
  unitPrice: 90_000,
};
const CREATED = {
  orderId: 'order-123',
  orderNo: 10_046,
  status: 'awaiting_receipt',
  subtotal: 370_000,
  shippingFee: 40_000,
  discount: 0,
  total: 410_000,
};

/** The checkout page, opened as after a reload: a fresh form. */
const openCheckout = () =>
  render(
    <CheckoutForm
      rates={RATES}
      defaultName=""
      defaultPhone=""
      payment={DEFAULT_CONTENT['checkout.payment']}
    />,
  );

/** Fills every step the same way and presses «ثبت سفارش», card to card. */
async function placeCardToCard() {
  fireEvent.change(screen.getByLabelText('نام و نام خانوادگی گیرنده'), {
    target: { value: 'سارا محمدی' },
  });
  fireEvent.change(screen.getByLabelText('شماره تماس گیرنده'), {
    target: { value: '09120000000' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'ادامه' }));
  fireEvent.change(screen.getByLabelText('استان'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('شهر'), {
    target: { value: 'تهران' },
  });
  fireEvent.change(screen.getByLabelText('آدرس کامل'), {
    target: { value: 'خیابان آزمایشی، کوچه دوم، پلاک ۱۲' },
  });
  fireEvent.change(screen.getByLabelText('کد پستی'), {
    target: { value: '1234567890' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'ادامه' }));
  fireEvent.click(screen.getByRole('radio', { name: /کارت به کارت/ }));
  await act(async () => {
    fireEvent.change(
      document.querySelector('[data-umami-event="checkout-receipt-file"]')!,
      {
        target: {
          files: [
            new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'رسید.jpg', {
              type: 'image/jpeg',
            }),
          ],
        },
      },
    );
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /ثبت سفارش/ }));
  });
}

/** The Idempotency-Key each create carried, in order. */
const keysSent = () =>
  postData.mock.calls
    .filter(([path]) => path === API_PATHS.CHECKOUT)
    .map(
      ([, , headers]) => (headers as Record<string, string>)['Idempotency-Key'],
    );

/** The create's answer never arrives: the order may well exist. */
const answerLost = () =>
  postData.mockRejectedValueOnce(new TypeError('Failed to fetch'));

beforeEach(() => {
  postForm.mockResolvedValue({
    id: '22222222-2222-2222-2222-222222222222',
    createdAt: '2026-10-02T09:30:00.000Z',
  });
  clearCart();
  addToCart(CAT_TOY, 2);
});

afterEach(() => {
  cleanup();
  clearCart();
  window.sessionStorage.clear();
  vi.useRealTimers();
  push.mockReset();
  replace.mockReset();
  postData.mockReset();
  postForm.mockReset();
});

describe('the checkout Idempotency-Key', () => {
  it('is resent after a reload when the answer to the same checkout was lost', async () => {
    answerLost();
    openCheckout();
    await placeCardToCard();

    cleanup(); // the shopper reloads; the cart is still there
    openCheckout();
    postData.mockResolvedValueOnce(CREATED);
    await placeCardToCard();

    const [lost, resent] = keysSent();
    expect(lost).toBeTruthy();
    expect(resent).toBe(lost);
  });

  it('is minted afresh for a different cart', async () => {
    answerLost();
    openCheckout();
    await placeCardToCard();

    cleanup();
    addToCart(CAT_FOOD, 1);
    openCheckout();
    answerLost();
    await placeCardToCard();

    const [first, second] = keysSent();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it('is never resent once its order was created — the same cart again is a new order', async () => {
    postData.mockResolvedValueOnce(CREATED);
    openCheckout();
    await placeCardToCard();
    expect(push).toHaveBeenCalledWith('/checkout/result/order-123');

    cleanup();
    addToCart(CAT_TOY, 2); // the order cleared the cart; the same one again
    openCheckout();
    answerLost();
    await placeCardToCard();

    const [created, next] = keysSent();
    expect(next).toBeTruthy();
    expect(next).not.toBe(created);
  });

  it('is not resent once half an hour has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T09:00:00.000Z'));
    answerLost();
    openCheckout();
    await placeCardToCard();

    cleanup();
    vi.setSystemTime(new Date('2026-10-02T09:30:00.000Z'));
    openCheckout();
    answerLost();
    await placeCardToCard();

    const [stale, fresh] = keysSent();
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(stale);
  });

  it('stays in memory for a retry when storage throws, as it did before', async () => {
    // A browser with storage switched off throws on the very access.
    const own = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    let accessed = 0;
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        accessed += 1;
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    try {
      postData.mockRejectedValueOnce(
        new ApiRequestError(422, 'ورودی نامعتبر', [
          'items.0: موجودی «اسباب‌بازی گربه» کافی نیست.',
        ]),
      );
      openCheckout();
      await placeCardToCard();
      // The refusal re-enabled the form; the shopper retries.
      postData.mockResolvedValueOnce(CREATED);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /ثبت سفارش/ }));
      });

      expect(accessed).toBeGreaterThan(0);
      const [refused, retried] = keysSent();
      expect(refused).toBeTruthy();
      expect(retried).toBe(refused);
      expect(push).toHaveBeenCalledWith('/checkout/result/order-123');
    } finally {
      if (own) Object.defineProperty(window, 'sessionStorage', own);
      else delete (window as { sessionStorage?: Storage }).sessionStorage;
    }
  });
});
