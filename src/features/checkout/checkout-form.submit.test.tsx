// Pins the submit state machine — the money-critical wiring no unit test can
// reach, since it lives between the form's state, the cart store, and the API.
// Four properties, each verified by reverting its guard and watching this fail:
//   · a double-submit sends ONE create (double orders = double fulfillment);
//   · a 422 re-enables the form, surfaces the message, keeps the cart, and the
//     retry reuses the SAME Idempotency-Key (nothing was created — the retry must
//     stay idempotent, not mint a fresh key);
//   · a 2xx clears the local cart and navigates to the result page.
//
// Mocked at the module edge only: `next/navigation` (router recorder) and
// `@/lib/api-client` (postData recorder — the real ApiRequestError is kept, since
// the form branches on `instanceof`). The cart store and `parseFieldErrors` run
// for real, so the cart-clear and error-mapping happen exactly as in production.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutForm } from './checkout-form';
import {
  addToCart,
  clearCart,
  getCart,
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

const { postData } = vi.hoisted(() => ({ postData: vi.fn() }));
vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return { ...actual, postData };
});

const RATES = [{ provinceId: 1, name: 'تهران', fee: 40_000 }];

const CAT_TOY: CartLineInput = {
  productId: 'p1',
  slug: 'cat-toy',
  title: 'اسباب‌بازی گربه',
  sku: 'SKU-1',
  unitPrice: 185_000,
};

/** Fills the three steps with valid input and lands on the payment step. */
function advanceToPayment() {
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
}

const submitButton = () =>
  screen.getByRole('button', { name: /ثبت سفارش/ }) as HTMLButtonElement;

beforeEach(() => {
  clearCart();
  addToCart(CAT_TOY, 2);
  render(<CheckoutForm rates={RATES} defaultName="" defaultPhone="" />);
});

afterEach(() => {
  cleanup();
  clearCart();
  push.mockReset();
  replace.mockReset();
  postData.mockReset();
});

describe('the checkout submit state machine', () => {
  it('sends exactly one create when the button is double-clicked', async () => {
    // A create that never settles, so the form stays "submitting" across clicks.
    postData.mockReturnValue(new Promise(() => undefined));
    advanceToPayment();

    const button = submitButton();
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(postData).toHaveBeenCalledTimes(1);
  });

  it('re-enables the form on a 422, shows the message, keeps the cart, and reuses the key on retry', async () => {
    postData.mockRejectedValue(
      new ApiRequestError(422, 'ورودی نامعتبر', [
        'items.0: موجودی «اسباب‌بازی گربه» کافی نیست.',
      ]),
    );
    advanceToPayment();

    await act(async () => {
      fireEvent.click(submitButton());
    });

    // The item message reached the top-level alert…
    expect(screen.getByRole('alert').textContent).toContain(
      'موجودی «اسباب‌بازی گربه» کافی نیست.',
    );
    // …the button is enabled again (no order was created)…
    expect(submitButton().disabled).toBe(false);
    // …and the cart is untouched.
    expect(getCart()).toHaveLength(1);

    // Retry: the second create carries the SAME Idempotency-Key.
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(postData).toHaveBeenCalledTimes(2);
    const firstKey = postData.mock.calls[0][2]['Idempotency-Key'];
    const secondKey = postData.mock.calls[1][2]['Idempotency-Key'];
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBe(firstKey);
  });

  it('clears the local cart and navigates to the result page on a COD success', async () => {
    postData.mockResolvedValue({
      orderId: 'order-123',
      orderNo: 10_046,
      status: 'processing',
      subtotal: 370_000,
      shippingFee: 40_000,
      discount: 0,
      total: 410_000,
    });
    advanceToPayment();

    // Choose cash on delivery — the branch that navigates straight to the result
    // page (no gateway hop).
    fireEvent.click(screen.getByRole('radio', { name: /پرداخت در محل/ }));

    await act(async () => {
      fireEvent.click(submitButton());
    });

    // Cart cleared immediately on the 2xx, before any navigation…
    expect(getCart()).toHaveLength(0);
    // …and the browser is sent to this order's result page.
    expect(push).toHaveBeenCalledWith('/checkout/result/order-123');
    // Only the checkout create ran — COD makes no payment-request call.
    expect(postData).toHaveBeenCalledTimes(1);
    // The now-empty cart must NOT bounce the shopper to the shop — the status
    // guard keeps the empty-cart redirect off while we are navigating to the
    // result. (Revert the `status === 'idle'` guard and this fails.)
    expect(replace).not.toHaveBeenCalled();
  });

  it('lands on the result page when the Zarinpal request fails after the order is created', async () => {
    // The checkout create succeeds (order exists, pending_payment) but starting
    // the gateway fails — the shopper must not be stranded on a cleared cart.
    postData
      .mockResolvedValueOnce({
        orderId: 'order-777',
        orderNo: 10_047,
        status: 'pending_payment',
        subtotal: 370_000,
        shippingFee: 40_000,
        discount: 0,
        total: 410_000,
      })
      .mockRejectedValueOnce(new ApiRequestError(500, 'خطای درگاه'));
    advanceToPayment();
    // Zarinpal is the default method — leave it selected.

    await act(async () => {
      fireEvent.click(submitButton());
    });

    expect(getCart()).toHaveLength(0); // cleared on the checkout 2xx
    expect(postData).toHaveBeenCalledTimes(2);
    expect(postData.mock.calls[1][0]).toBe(API_PATHS.PAYMENT_REQUEST);
    expect(postData.mock.calls[1][1]).toEqual({ orderId: 'order-777' });
    expect(push).toHaveBeenCalledWith('/checkout/result/order-777');
  });

  it('redirects to the Zarinpal gateway on a successful payment request', async () => {
    const assign = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => undefined);
    postData
      .mockResolvedValueOnce({
        orderId: 'order-888',
        orderNo: 10_048,
        status: 'pending_payment',
        subtotal: 100_000,
        shippingFee: 40_000,
        discount: 0,
        total: 140_000,
      })
      .mockResolvedValueOnce({
        redirectUrl: 'https://gateway.example/pay/abc',
      });
    advanceToPayment();

    await act(async () => {
      fireEvent.click(submitButton());
    });

    expect(getCart()).toHaveLength(0);
    expect(postData.mock.calls[1][0]).toBe(API_PATHS.PAYMENT_REQUEST);
    expect(assign).toHaveBeenCalledWith('https://gateway.example/pay/abc');
    expect(push).not.toHaveBeenCalled(); // went to the gateway, not the result
    assign.mockRestore();
  });

  it('redirects an empty cart to the shop', () => {
    // Back-button to /checkout after an order cleared the cart: no page to sit
    // on, and no accidental second order.
    cleanup();
    clearCart();
    render(<CheckoutForm rates={RATES} defaultName="" defaultPhone="" />);

    expect(replace).toHaveBeenCalledWith('/shop');
  });

  it('surfaces a server error with no field mapping in the top-level alert', async () => {
    postData.mockRejectedValue(new ApiRequestError(500, 'خطای سرور'));
    advanceToPayment();

    await act(async () => {
      fireEvent.click(submitButton());
    });

    expect(screen.getByRole('alert').textContent).toContain('خطای سرور');
    expect(submitButton().disabled).toBe(false);
    expect(getCart()).toHaveLength(1); // nothing created, cart kept
  });
});
