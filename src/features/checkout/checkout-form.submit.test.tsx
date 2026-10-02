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
// `@/lib/api-client` (postData and postForm recorders — the real ApiRequestError
// is kept, since the form branches on `instanceof`). The cart store and
// `parseFieldErrors` run for real, so the cart-clear and error-mapping happen
// exactly as in production. A card-to-card checkout attaches its screenshot
// first, and its upload succeeds unless a test says otherwise — the receipt's
// own wiring is ./checkout-form.receipt.test.tsx's.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutForm } from './checkout-form';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
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

const { postData, postForm } = vi.hoisted(() => ({
  postData: vi.fn(),
  postForm: vi.fn(),
}));
vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return { ...actual, postData, postForm };
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
function advanceToPayment({ saveAddress = false } = {}) {
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
  if (saveAddress) {
    fireEvent.click(screen.getByLabelText(/این آدرس را در حساب کاربری‌ام/));
  }
  fireEvent.click(screen.getByRole('button', { name: 'ادامه' }));
}

const submitButton = () =>
  screen.getByRole('button', { name: /ثبت سفارش/ }) as HTMLButtonElement;

/** Chooses card to card and attaches a screenshot — a JPEG by its bytes. */
async function payCardToCard() {
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
}

beforeEach(() => {
  postForm.mockResolvedValue({
    id: '22222222-2222-2222-2222-222222222222',
    createdAt: '2026-10-02T09:30:00.000Z',
  });
  clearCart();
  addToCart(CAT_TOY, 2);
  render(
    <CheckoutForm
      rates={RATES}
      defaultName=""
      defaultPhone=""
      payment={DEFAULT_CONTENT['checkout.payment']}
    />,
  );
});

afterEach(() => {
  cleanup();
  clearCart();
  push.mockReset();
  replace.mockReset();
  postData.mockReset();
  postForm.mockReset();
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

  it('shows a paymentMethod 422 in the alert — those radios have no error slot', async () => {
    // Where createOrder's two per-user caps land. `paymentMethod` is a field
    // path, so it parses as a field error — but nothing renders one, so without
    // a home in the top-level alert the shopper sees the button re-enable and
    // nothing else, and simply presses it again.
    postData.mockRejectedValue(
      new ApiRequestError(422, 'ورودی نامعتبر', [
        'paymentMethod: تعداد سفارش‌های شما در یک ساعت گذشته بیش از حد مجاز است؛ لطفاً بعداً دوباره تلاش کنید.',
      ]),
    );
    advanceToPayment();

    await act(async () => {
      fireEvent.click(submitButton());
    });

    expect(screen.getByRole('alert').textContent).toContain(
      'یک ساعت گذشته بیش از حد مجاز است',
    );
    expect(submitButton().disabled).toBe(false);
    expect(getCart()).toHaveLength(1);
  });

  it('maps a 400 per-field error inline and jumps back to its step', async () => {
    // A body-schema 400 (e.g. an over-length field) carries the same
    // `field: message` shape as a 422; the form must render it on the input and
    // jump to that step, not dump a generic message in the top alert. Revert the
    // `|| error.status === 400` guard and this fails (the city field — on step 2
    // — is never shown, so getByLabelText below throws).
    postData.mockRejectedValue(
      new ApiRequestError(400, 'ورودی نامعتبر است', [
        'address.city: مقدار واردشده بیش از حد طولانی است.',
      ]),
    );
    advanceToPayment(); // lands on the payment step (step 3)

    await act(async () => {
      fireEvent.click(submitButton());
    });

    // Jumped back to step 2 (the city field is on screen again)…
    expect(screen.getByLabelText('شهر')).toBeTruthy();
    // …with the server's Persian message rendered inline on the field…
    expect(
      screen.getByText('مقدار واردشده بیش از حد طولانی است.'),
    ).toBeTruthy();
    // …and the cart kept (nothing was created).
    expect(getCart()).toHaveLength(1);
  });

  it('clears the local cart and navigates to the result page on a COD success', async () => {
    postData.mockResolvedValue({
      orderId: 'order-123',
      orderNo: 10_046,
      status: 'awaiting_receipt',
      subtotal: 370_000,
      shippingFee: 40_000,
      discount: 0,
      total: 410_000,
    });
    advanceToPayment();

    // Card to card, its screenshot attached — the branch that navigates
    // straight to the result page (no gateway hop).
    await payCardToCard();

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
    render(
      <CheckoutForm
        rates={RATES}
        defaultName=""
        defaultPhone=""
        payment={DEFAULT_CONTENT['checkout.payment']}
      />,
    );

    expect(replace).toHaveBeenCalledWith('/shop');
  });

  it('with Zarinpal switched off, disables that option and preselects card to card', () => {
    cleanup();
    render(
      <CheckoutForm
        rates={RATES}
        defaultName=""
        defaultPhone=""
        payment={DEFAULT_CONTENT['checkout.payment']}
        zarinpalEnabled={false}
      />,
    );
    advanceToPayment();

    const zarinpal = screen.getByRole('radio', {
      name: /زرین‌پال/,
    }) as HTMLInputElement;
    const card = screen.getByRole('radio', {
      name: /کارت به کارت/,
    }) as HTMLInputElement;
    expect(zarinpal.disabled).toBe(true);
    expect(zarinpal.checked).toBe(false);
    expect(card.checked).toBe(true);
    // No gateway hop is offered: the button is the plain "place order".
    expect(submitButton().textContent).toBe('ثبت سفارش');
  });

  it('saves the address to the account when opted in, then still navigates', async () => {
    // COD: create resolves, then the best-effort address save resolves too.
    postData.mockResolvedValue({
      orderId: 'order-555',
      orderNo: 10_050,
      status: 'awaiting_receipt',
      subtotal: 370_000,
      shippingFee: 40_000,
      discount: 0,
      total: 410_000,
    });
    advanceToPayment({ saveAddress: true });
    await payCardToCard();

    await act(async () => {
      fireEvent.click(submitButton());
    });

    // The save fired against the owner-scoped addresses route, carrying the same
    // address the order snapshotted. (Revert the `if (saveAddress)` block and no
    // such call exists — this fails.)
    const saveCall = postData.mock.calls.find(
      (call) => call[0] === API_PATHS.ME_ADDRESSES,
    );
    expect(saveCall).toBeTruthy();
    expect(saveCall![1]).toMatchObject({
      recipientName: 'سارا محمدی',
      provinceId: 1,
      city: 'تهران',
      postalCode: '1234567890',
    });
    // …and the shopper still lands on the result page.
    expect(push).toHaveBeenCalledWith('/checkout/result/order-555');
  });

  it('never lets a failed address save block or fail the redirect', async () => {
    // The order is created (COD), but the best-effort save is rejected (e.g. the
    // per-user cap). The redirect must happen anyway. Revert the try/catch around
    // the save and this throws out of submit, leaving `push` uncalled.
    postData
      .mockResolvedValueOnce({
        orderId: 'order-556',
        orderNo: 10_051,
        status: 'awaiting_receipt',
        subtotal: 370_000,
        shippingFee: 40_000,
        discount: 0,
        total: 410_000,
      })
      .mockRejectedValueOnce(
        new ApiRequestError(422, 'به سقف تعداد آدرس‌ها رسیده‌ای.'),
      );
    advanceToPayment({ saveAddress: true });
    await payCardToCard();

    await act(async () => {
      fireEvent.click(submitButton());
    });

    expect(getCart()).toHaveLength(0); // order succeeded, cart cleared
    expect(push).toHaveBeenCalledWith('/checkout/result/order-556');
  });

  it('applies a code from the server preview and sends discountCode in the create body', async () => {
    // The discount amount shown must be the SERVER's — the form calls the preview
    // endpoint and reflects its `{subtotal, discount}`, then the create carries the
    // code so the server re-validates and claims it. Revert the `discountCode` line
    // in the submit body and the create call below no longer carries it.
    postData.mockImplementation((path: string) => {
      if (path === API_PATHS.CHECKOUT_PREVIEW) {
        return Promise.resolve({ subtotal: 370_000, discount: 37_000 });
      }
      if (path === API_PATHS.CHECKOUT) {
        return Promise.resolve({
          orderId: 'order-900',
          orderNo: 10_060,
          status: 'awaiting_receipt',
          subtotal: 370_000,
          shippingFee: 40_000,
          discount: 37_000,
          total: 373_000,
        });
      }
      return Promise.resolve({});
    });

    fireEvent.change(screen.getByLabelText('کد تخفیف'), {
      target: { value: 'save10' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'اعمال' }));
    });
    // The preview ran against the current cart + code…
    const previewCall = postData.mock.calls.find(
      (call) => call[0] === API_PATHS.CHECKOUT_PREVIEW,
    );
    expect(previewCall![1]).toMatchObject({ discountCode: 'save10' });
    // …and the server-computed discount is confirmed to the shopper.
    expect(screen.getByText('کد تخفیف اعمال شد.')).toBeTruthy();

    advanceToPayment();
    await payCardToCard();
    await act(async () => {
      fireEvent.click(submitButton());
    });

    const createCall = postData.mock.calls.find(
      (call) => call[0] === API_PATHS.CHECKOUT,
    );
    expect(createCall![1]).toMatchObject({ discountCode: 'save10' });
  });

  it('drops the applied discount when the code text changes (derived, not sticky)', async () => {
    // The applied preview is valid only while the code text still matches what it
    // was computed for — `activeDiscount` DERIVES that at render, no setState in an
    // effect. Revert the derivation to `activeDiscount = applied` (drop the code
    // match) and this fails: the stale confirmation sticks after a retype.
    postData.mockResolvedValue({ subtotal: 370_000, discount: 37_000 });

    const codeInput = screen.getByLabelText('کد تخفیف');
    fireEvent.change(codeInput, { target: { value: 'save10' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'اعمال' }));
    });
    expect(screen.getByText('کد تخفیف اعمال شد.')).toBeTruthy();

    // Retype: the applied preview no longer matches the code, so the confirmation
    // drops at render — no effect, no cascading update.
    fireEvent.change(codeInput, { target: { value: 'save11' } });
    expect(screen.queryByText('کد تخفیف اعمال شد.')).toBeNull();
  });

  it('shows a preview 400 for another field in Persian, never its zod text', async () => {
    // A zod 400 names `items.0.quantity` in English; the code input has no such
    // field, so it reads the envelope's own Persian sentence instead.
    postData.mockRejectedValue(
      new ApiRequestError(400, 'ورودی نامعتبر است', [
        'items.0.quantity: Too small: expected number to be >0',
      ]),
    );
    fireEvent.change(screen.getByLabelText('کد تخفیف'), {
      target: { value: 'save10' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'اعمال' }));
    });

    expect(screen.getByText('ورودی نامعتبر است')).toBeTruthy();
    expect(screen.queryByText(/Too small/)).toBeNull();
  });

  it('renders a discountCode 422 inline on the code input', async () => {
    postData.mockRejectedValue(
      new ApiRequestError(422, 'کد تخفیف واردشده معتبر نیست.', [
        'discountCode: کد تخفیف واردشده معتبر نیست.',
      ]),
    );
    fireEvent.change(screen.getByLabelText('کد تخفیف'), {
      target: { value: 'BADCODE' },
    });
    advanceToPayment();
    await payCardToCard();

    await act(async () => {
      fireEvent.click(submitButton());
    });

    // The message is shown inline (the code input's own error), and the cart kept.
    expect(screen.getByText('کد تخفیف واردشده معتبر نیست.')).toBeTruthy();
    expect(getCart()).toHaveLength(1);
  });

  it('surfaces a server error in Persian in the top-level alert', async () => {
    // A 5xx `message` is the literal `Internal server error` — English
    // developer text the shopper must never read.
    postData.mockRejectedValue(
      new ApiRequestError(500, 'Internal server error'),
    );
    advanceToPayment();

    await act(async () => {
      fireEvent.click(submitButton());
    });

    expect(screen.getByRole('alert').textContent).toBe(
      'ثبت سفارش انجام نشد. لطفاً دوباره تلاش کن.',
    );
    expect(submitButton().disabled).toBe(false);
    expect(getCart()).toHaveLength(1); // nothing created, cart kept
  });
});
