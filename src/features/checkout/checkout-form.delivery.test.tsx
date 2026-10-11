// Pins the delivery-method wiring ([[Story - Courier Delivery at Checkout]]):
//   · in Tehran the shopper can pick «ارسال با پیک»; the summary then names the
//     courier instead of a fee, the total drops the fee, and the create body
//     says `courier`;
//   · outside Tehran the courier option is disabled and the body says `post`;
//   · a courier pick followed by a move out of Tehran sends `post` — the
//     choice is derived against the province at render, so no stale courier
//     reaches the server (which would refuse it);
//   · the server's courier refusal shows in the top alert, not nowhere.
//
// Mocked at the module edge only: `next/navigation` and the API client's
// `postData` (a create that never settles, so the body can be read).
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
import { formatToman } from '@/lib/format';
import {
  COURIER_FEE_TEXT,
  COURIER_TEHRAN_ONLY,
  COURIER_UNAVAILABLE,
} from '@/lib/orders/delivery-method';

const { push, replace } = vi.hoisted(() => ({
  push: vi.fn<(href: string) => void>(),
  replace: vi.fn<(href: string) => void>(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
}));

const { postData } = vi.hoisted(() => ({ postData: vi.fn() }));
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  postData,
}));

const TEHRAN = 1;
const ISFAHAN = 2;
// The Arabic-letter and spacing variants of «تهران» are the unit test's
// (`delivery-method.test.ts`); here the province list is the stored one.
const RATES = [
  { provinceId: TEHRAN, name: 'تهران', fee: 40_000 },
  { provinceId: ISFAHAN, name: 'اصفهان', fee: 55_000 },
];

const CAT_TOY: CartLineInput = {
  productId: 'p1',
  slug: 'cat-toy',
  title: 'اسباب‌بازی گربه',
  sku: 'SKU-1',
  unitPrice: 185_000,
};

const next = () =>
  fireEvent.click(screen.getByRole('button', { name: 'ادامه' }));

/** Fills the first two steps with the province given and lands on step 3. */
function advanceToLastStep(provinceId: number) {
  fireEvent.change(screen.getByLabelText('نام و نام خانوادگی گیرنده'), {
    target: { value: 'سارا محمدی' },
  });
  fireEvent.change(screen.getByLabelText('شماره تماس گیرنده'), {
    target: { value: '09120000000' },
  });
  next();
  fireEvent.change(screen.getByLabelText('استان'), {
    target: { value: String(provinceId) },
  });
  fireEvent.change(screen.getByLabelText('شهر'), {
    target: { value: 'تهران' },
  });
  fireEvent.change(screen.getByLabelText('آدرس کامل'), {
    target: { value: 'خیابان آزمایشی، کوچه دوم، پلاک ۱۲' },
  });
  fireEvent.change(screen.getByLabelText('کد پستی'), {
    target: { value: '1234567890' },
  });
  next();
}

const courierRadio = () =>
  screen.getByRole('radio', { name: /ارسال با پیک/ }) as HTMLInputElement;
const postRadio = () =>
  screen.getByRole('radio', { name: /^پست/ }) as HTMLInputElement;

async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /ثبت سفارش/ }));
  });
}

/** The body of the one create the form sent. */
const sentBody = () => {
  expect(postData).toHaveBeenCalledTimes(1);
  return postData.mock.calls[0][1] as { deliveryMethod: string };
};

beforeEach(() => {
  // A create that never settles: the body is what these tests read.
  postData.mockReturnValue(new Promise(() => undefined));
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
});

describe('the checkout delivery method', () => {
  it('starts on post, with the province fee in the summary', () => {
    advanceToLastStep(TEHRAN);

    expect(postRadio().checked).toBe(true);
    expect(courierRadio().checked).toBe(false);
    expect(screen.getByText(formatToman(40_000))).toBeTruthy();
    expect(screen.getByText(formatToman(370_000 + 40_000))).toBeTruthy();
  });

  it('in Tehran, sends courier and shows no fee once the shopper picks it', async () => {
    advanceToLastStep(TEHRAN);

    expect(courierRadio().disabled).toBe(false);
    fireEvent.click(courierRadio());

    expect(courierRadio().checked).toBe(true);
    expect(screen.getByText(COURIER_FEE_TEXT)).toBeTruthy();
    expect(screen.queryByText(formatToman(40_000))).toBeNull();
    // The total is the items alone — subtotal and total read the same.
    expect(screen.getAllByText(formatToman(370_000))).toHaveLength(3);

    await submit();
    expect(sentBody().deliveryMethod).toBe('courier');
  });

  it('switching back to post restores the fee', () => {
    advanceToLastStep(TEHRAN);
    fireEvent.click(courierRadio());
    fireEvent.click(postRadio());

    expect(screen.queryByText(COURIER_FEE_TEXT)).toBeNull();
    expect(screen.getByText(formatToman(410_000))).toBeTruthy();
  });

  it('outside Tehran, disables courier, says why, and sends post', async () => {
    advanceToLastStep(ISFAHAN);

    expect(courierRadio().disabled).toBe(true);
    expect(screen.getByText(COURIER_TEHRAN_ONLY)).toBeTruthy();

    await submit();
    expect(sentBody().deliveryMethod).toBe('post');
  });

  it('falls back to post when the address moves out of Tehran after a courier pick', async () => {
    advanceToLastStep(TEHRAN);
    fireEvent.click(courierRadio());

    fireEvent.click(screen.getByRole('button', { name: 'مرحله قبل' }));
    fireEvent.change(screen.getByLabelText('استان'), {
      target: { value: String(ISFAHAN) },
    });
    next();

    expect(postRadio().checked).toBe(true);
    expect(screen.queryByText(COURIER_FEE_TEXT)).toBeNull();
    expect(screen.getByText(formatToman(55_000))).toBeTruthy();

    await submit();
    expect(sentBody().deliveryMethod).toBe('post');
  });

  it("shows the server's courier refusal in the top alert", async () => {
    postData.mockRejectedValue(
      new ApiRequestError(422, COURIER_UNAVAILABLE, [
        `deliveryMethod: ${COURIER_UNAVAILABLE}`,
      ]),
    );
    advanceToLastStep(TEHRAN);
    fireEvent.click(courierRadio());

    await submit();
    expect(screen.getByRole('alert').textContent).toContain(
      COURIER_UNAVAILABLE,
    );
  });
});
