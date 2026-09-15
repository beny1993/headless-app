// Pins the saved-address shortcut through the checkout wizard. A saved address
// is a complete `CheckoutAddressInput`, so once one is picked on the first step
// the address step has nothing left to ask: «ادامه» must go straight to payment,
// «مرحله قبل» from there back to the first step, and the order must carry the
// saved fields untouched. «آدرس جدید», the default, keeps the address step — and
// picking it after a saved address empties the address fields again. A saved
// address on a deactivated province is deliberately NOT shortcut; that case is
// ./checkout-form.province.test.tsx.
//
// Mocked at the module edge only: `next/navigation` (router recorder) and
// `@/lib/api-client`'s `postData`. The cart store runs for real. Harness as in
// ./checkout-form.submit.test.tsx.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutForm } from './checkout-form';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import { addToCart, clearCart } from '@/features/storefront/cart/cart';
import type { AddressResponse } from '@/lib/hono/routes/me-addresses';

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

/** On the one active province, so nothing stands between it and payment. */
const SAVED: AddressResponse = {
  id: 'address-1',
  title: 'خانه',
  recipientName: 'سارا محمدی',
  recipientPhone: '09120000000',
  provinceId: 1,
  provinceName: 'تهران',
  city: 'تهران',
  postalCode: '1234567890',
  addressLine: 'خیابان آزادی، کوچه بهار، پلاک ۱۲',
  createdAt: '2026-09-01T00:00:00Z',
};

const savedSelect = () =>
  document.querySelector<HTMLSelectElement>(
    '[data-umami-event="checkout-saved-address-select"]',
  );
/** `''` is «آدرس جدید»; a saved address is its index in `savedAddresses`. */
const pick = (value: string) =>
  fireEvent.change(savedSelect()!, { target: { value } });
const next = () =>
  fireEvent.click(screen.getByRole('button', { name: 'ادامه' }));
const back = () =>
  fireEvent.click(screen.getByRole('button', { name: 'مرحله قبل' }));
/** The payment step is the only one with radios; the address step the only one with «شهر». */
const onPayment = () => screen.queryAllByRole('radio').length > 0;
const onAddress = () => screen.queryByLabelText('شهر') !== null;

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
      defaultName="سارا محمدی"
      defaultPhone="09120000000"
      savedAddresses={[SAVED]}
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

describe('checkout — a saved address skips the address step', () => {
  it('goes from the first step straight to payment, with the address step marked done', () => {
    pick('0');
    next();

    expect(onPayment()).toBe(true);
    expect(onAddress()).toBe(false);

    // The stepper agrees: payment is current and the address step is ticked,
    // not numbered «۲».
    const [, address, payment] = screen.getAllByRole('listitem');
    expect(payment.getAttribute('aria-current')).toBe('step');
    expect(address.textContent).not.toContain('۲');
  });

  it('comes back from payment to the first step, with the address still picked', () => {
    pick('0');
    next();
    back();

    expect(savedSelect()?.value).toBe('0');
    expect(onAddress()).toBe(false);

    // …and forward again is still the shortcut.
    next();
    expect(onPayment()).toBe(true);
  });

  it('keeps the address step for «آدرس جدید», the default', () => {
    next();

    expect(onAddress()).toBe(true);
    expect((screen.getByLabelText('استان') as HTMLSelectElement).value).toBe(
      '',
    );
  });

  it('empties the address fields when «آدرس جدید» is picked after a saved address', () => {
    pick('0');
    pick('');
    next();

    expect(onAddress()).toBe(true);
    expect((screen.getByLabelText('استان') as HTMLSelectElement).value).toBe(
      '',
    );
    expect((screen.getByLabelText('شهر') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('کد پستی') as HTMLInputElement).value).toBe(
      '',
    );
    expect(
      (screen.getByLabelText('آدرس کامل') as HTMLTextAreaElement).value,
    ).toBe('');
  });

  it('submits the saved address, field for field', async () => {
    pick('0');
    next();

    postData.mockReturnValue(new Promise(() => undefined));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ثبت سفارش/ }));
    });

    expect(postData.mock.calls[0][1]).toMatchObject({
      address: {
        recipientName: SAVED.recipientName,
        recipientPhone: SAVED.recipientPhone,
        provinceId: SAVED.provinceId,
        city: SAVED.city,
        postalCode: SAVED.postalCode,
        addressLine: SAVED.addressLine,
      },
    });
  });
});
