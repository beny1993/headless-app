// Pins which Idempotency-Key a checkout create carries. The server hands back
// the order a known key already made, whatever body comes with it
// (`createOrder`'s replay), so each key travels with the body it was minted
// for — kept as the body's SHA-256, never the body:
//   · a create whose answer was lost is resent with the same key after a
//     reload — the form mounted afresh — so it gets that order back instead of
//     placing a second one;
//   · a different body is a different checkout and gets a fresh key, or the
//     server would answer it with the old order — and going back to the first
//     body resends the first key;
//   · an order created consumes its key: buying the same cart again later is a
//     new order;
//   · a key not sent for half an hour is not resent, and is pruned;
//   · storage that throws leaves the keys in memory, as before, and a memory
//     copy is never hidden by storage holding another body's key;
//   · storage holds no name, phone or address.
//
// Mocked at the module edge only: `next/navigation` and `@/lib/api-client`'s
// `postData` and `postForm`. The cart store and `sessionStorage` (happy-dom's)
// run for real; the body's SHA-256 is the real one, computed in step by
// `src/test-setup.ts`'s stand-in for `crypto.subtle.digest`.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutForm } from './checkout-form';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import {
  addToCart,
  clearCart,
  removeFromCart,
  type CartLineInput,
} from '@/features/storefront/cart/cart';
import { ApiRequestError } from '@/lib/api-client';
import { API_PATHS } from '@/lib/constant/paths';
import { CHECKOUT_KEY_STORAGE } from './checkout-key';

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

/** «ثبت سفارش» again, on the form as it stands. */
const submitAgain = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /ثبت سفارش/ }));
  });
};

/** What `sessionStorage` holds for the checkout keys, as stored. */
const stored = () => window.sessionStorage.getItem(CHECKOUT_KEY_STORAGE);

/**
 * Runs `body` in a browser whose storage throws on the very access, as one
 * with storage switched off does, and counts the accesses.
 */
async function withoutStorage(body: () => Promise<void>) {
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
    await body();
  } finally {
    if (own) Object.defineProperty(window, 'sessionStorage', own);
    else delete (window as { sessionStorage?: Storage }).sessionStorage;
  }
  expect(accessed).toBeGreaterThan(0);
}

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
    await withoutStorage(async () => {
      postData.mockRejectedValueOnce(
        new ApiRequestError(422, 'ورودی نامعتبر', [
          'items.0: موجودی «اسباب‌بازی گربه» کافی نیست.',
        ]),
      );
      openCheckout();
      await placeCardToCard();
      // The refusal re-enabled the form; the shopper retries.
      postData.mockResolvedValueOnce(CREATED);
      await submitAgain();
    });

    const [refused, retried] = keysSent();
    expect(refused).toBeTruthy();
    expect(retried).toBe(refused);
    expect(push).toHaveBeenCalledWith('/checkout/result/order-123');
  });

  it.each([
    ['with storage', (body: () => Promise<void>) => body()],
    ['with storage switched off', withoutStorage],
  ])(
    'resends the first key when the shopper goes back to the first cart — %s',
    async (_, browser) => {
      await browser(async () => {
        answerLost();
        openCheckout();
        await placeCardToCard(); // cart A

        act(() => addToCart(CAT_FOOD, 1));
        answerLost();
        await submitAgain(); // cart B

        act(() => removeFromCart(CAT_FOOD.productId));
        answerLost();
        await submitAgain(); // cart A again
      });

      const [a, b, aAgain] = keysSent();
      expect(b).not.toBe(a);
      expect(aAgain).toBe(a);
    },
  );

  it('keeps no name, phone or address in storage — the body’s digest only', async () => {
    answerLost();
    openCheckout();
    await placeCardToCard();

    const raw = stored() ?? '';
    for (const value of [
      'سارا',
      '09120000000',
      '1234567890',
      'خیابان',
      'تهران',
      'p1',
    ]) {
      expect(raw).not.toContain(value);
    }
    expect(JSON.parse(raw)).toEqual([
      {
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        key: keysSent()[0],
        at: expect.any(Number),
      },
    ]);
  });

  it('prunes a key gone stale, and removes the list once it is empty', async () => {
    const stale = {
      digest: 'e'.repeat(64),
      key: '33333333-3333-4333-8333-333333333333',
      at: Date.now() - 31 * 60 * 1000,
    };
    window.sessionStorage.setItem(
      CHECKOUT_KEY_STORAGE,
      JSON.stringify([stale]),
    );

    answerLost();
    openCheckout();
    await placeCardToCard();
    expect(stored()).not.toContain(stale.digest);

    // The resend creates the order: its key is forgotten, and nothing is left.
    postData.mockResolvedValueOnce(CREATED);
    await submitAgain();
    expect(stored()).toBeNull();
  });

  it('counts the half hour from the last time a key was sent', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T09:00:00.000Z'));
    answerLost();
    openCheckout();
    await placeCardToCard();

    vi.setSystemTime(new Date('2026-10-02T09:20:00.000Z'));
    answerLost();
    await submitAgain();

    // Forty-five minutes after it was minted, twenty-five after it was last sent.
    vi.setSystemTime(new Date('2026-10-02T09:45:00.000Z'));
    answerLost();
    await submitAgain();

    const [first, second, third] = keysSent();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('reuses its memory copy when storage holds only another body’s key', async () => {
    answerLost();
    openCheckout();
    await placeCardToCard();
    // Storage now speaks for another checkout only — this one is in memory.
    window.sessionStorage.setItem(
      CHECKOUT_KEY_STORAGE,
      JSON.stringify([
        {
          digest: 'b'.repeat(64),
          key: '44444444-4444-4444-8444-444444444444',
          at: Date.now(),
        },
      ]),
    );

    answerLost();
    await submitAgain();

    const [first, resent] = keysSent();
    expect(resent).toBe(first);
  });
});
