// Pins the stale-province guard on checkout's saved-address prefill. The prefill
// copies the address's `provinceId` into a controlled <select> built from the
// ACTIVE rates; for a deactivated province no option matches, so the select
// shows its placeholder while state keeps the stale id and «ادامه» would carry
// it into `POST /api/checkout`'s 422. The form must say so in Persian on the
// address step and refuse to advance until another province is picked.
//
// Mocked at the module edge only: `next/navigation` (router recorder) and
// `@/lib/api-client`'s `postData` (the real ApiRequestError is kept). The cart
// store runs for real. Harness as in ./checkout-form.submit.test.tsx.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutForm } from './checkout-form';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import { addToCart, clearCart } from '@/features/storefront/cart/cart';
import type { AddressResponse } from '@/lib/hono/routes/me-addresses';
import { STALE_PROVINCE_MESSAGE } from '@/lib/shipping/province-input';

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

/** Only Tehran is active; the saved address is on «قم» (id 9), since deactivated. */
const RATES = [{ provinceId: 1, name: 'تهران', fee: 40_000 }];

const STALE_ADDRESS: AddressResponse = {
  id: 'address-1',
  title: 'خانه',
  recipientName: 'سارا محمدی',
  recipientPhone: '09120000000',
  provinceId: 9,
  provinceName: 'قم',
  city: 'قم',
  postalCode: '1234567890',
  addressLine: 'خیابان آزمایشی، کوچه دوم، پلاک ۱۲',
  createdAt: '2026-09-01T00:00:00Z',
};

const next = () =>
  fireEvent.click(screen.getByRole('button', { name: 'ادامه' }));

beforeEach(() => {
  clearCart();
  addToCart(
    {
      productId: 'p1',
      slug: 'cat-toy',
      title: 'اسباب بازی گربه',
      sku: 'SKU-1',
      unitPrice: 185_000,
    },
    1,
  );
  render(
    <CheckoutForm
      rates={RATES}
      defaultName=""
      defaultPhone=""
      savedAddresses={[STALE_ADDRESS]}
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

describe('checkout — a saved address on a deactivated province', () => {
  it('warns on the address step and will not advance until another province is picked', async () => {
    fireEvent.change(
      document.querySelector(
        '[data-umami-event="checkout-saved-address-select"]',
      )!,
      { target: { value: '0' } },
    );
    next(); // name + phone came from the prefill

    // On the address step the warning is already there, before «ادامه», over
    // the placeholder — not over «تهران», which React would otherwise select
    // (and which re-picking would not fire a change for).
    expect(screen.getByText(STALE_PROVINCE_MESSAGE)).toBeTruthy();
    expect((screen.getByLabelText('استان') as HTMLSelectElement).value).toBe(
      '',
    );

    // …and «ادامه» stays on the address step.
    next();
    expect(screen.getByLabelText('شهر')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();

    fireEvent.change(screen.getByLabelText('استان'), {
      target: { value: '1' },
    });
    expect(screen.queryByText(STALE_PROVINCE_MESSAGE)).toBeNull();

    next();
    expect(screen.getAllByRole('radio')).not.toHaveLength(0);
    expect(postData).not.toHaveBeenCalled();

    postData.mockReturnValue(new Promise(() => undefined));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ثبت سفارش/ }));
    });
    expect(postData.mock.calls[0][1]).toMatchObject({
      address: { provinceId: 1 },
    });
  });
});
