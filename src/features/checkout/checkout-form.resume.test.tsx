// Pins how the checkout picks a waiting card-to-card order back up after the
// page that held its retry is gone (a reload, a closed tab):
//   · with `?resume=` the form opens on that order's retry screen — its own
//     lines and totals, the picker, «ارسال دوباره رسید» — and resending goes
//     to that order: no create, no address-book write, then its result page;
//   · an empty cart with a waiting order goes to that order's retry, not the
//     shop; an empty cart with none still goes to the shop;
//   · a filled cart keeps its own checkout, with a note leading to the
//     waiting order.
//
// Mocked at the module edge only: `next/navigation` (recorders) and the API
// client (`ApiRequestError` stays real). The cart store and the receipt byte
// check run for real.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutForm, type ResumableOrder } from './checkout-form';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import { addToCart, clearCart } from '@/features/storefront/cart/cart';
import {
  API_PATHS,
  PATHS,
  apiOrderReceiptsPath,
  checkoutResultPath,
  checkoutResumePath,
} from '@/lib/constant/paths';

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

const WAITING: ResumableOrder = {
  orderId: '77777777-7777-4777-8777-777777777777',
  lines: [
    {
      id: 'line-1',
      title: 'غذای خشک گربه',
      qty: 1,
      lineTotal: 185_000,
    },
  ],
  subtotal: 185_000,
  discount: 0,
  shippingFee: 40_000,
  total: 225_000,
};

const form = (props: { resume?: ResumableOrder; resumed?: boolean }) =>
  render(
    <CheckoutForm
      rates={RATES}
      defaultName=""
      defaultPhone=""
      payment={DEFAULT_CONTENT['checkout.payment']}
      {...props}
    />,
  );

const submitButton = () =>
  screen.getByRole('button', {
    name: /ثبت سفارش|در حال|ارسال دوباره رسید/,
  }) as HTMLButtonElement;

const receiptInput = () =>
  document.querySelector<HTMLInputElement>(
    '[data-umami-event="checkout-receipt-file"]',
  )!;

/** A phone's screenshot: a JPEG by its bytes. */
const screenshot = () =>
  new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'IMG_0001.jpg', {
    type: 'image/jpeg',
  });

beforeEach(() => clearCart());

afterEach(() => {
  cleanup();
  clearCart();
  push.mockReset();
  replace.mockReset();
  postData.mockReset();
  postForm.mockReset();
});

describe('the checkout resuming a waiting card-to-card order', () => {
  it('opens on that order’s retry screen and resends to it — no create, no address book', async () => {
    postForm.mockResolvedValue({
      id: '22222222-2222-2222-2222-222222222222',
      createdAt: '2026-10-07T09:30:00.000Z',
    });
    form({ resume: WAITING, resumed: true });

    expect(replace).not.toHaveBeenCalled();
    expect(submitButton().textContent).toBe('ارسال دوباره رسید');
    // Nothing to send until a screenshot is attached.
    expect(submitButton().disabled).toBe(true);
    expect(
      screen.getByRole('link', { name: 'مشاهده سفارش' }).getAttribute('href'),
    ).toBe(checkoutResultPath(WAITING.orderId));
    expect(
      (screen.getByRole('radio', { name: /کارت به کارت/ }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    // The summary is the order's, at the server's total.
    expect(screen.getByText('غذای خشک گربه')).toBeTruthy();
    expect(document.body.textContent).toContain('۲۲۵٬۰۰۰');

    await act(async () => {
      fireEvent.change(receiptInput(), { target: { files: [screenshot()] } });
    });
    await act(async () => {
      fireEvent.click(submitButton());
    });

    expect(postForm.mock.calls[0][0]).toBe(
      apiOrderReceiptsPath(WAITING.orderId),
    );
    expect(postData).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(checkoutResultPath(WAITING.orderId));
  });

  it('sends an empty cart with a waiting order to that order’s retry, not the shop', () => {
    form({ resume: WAITING });

    expect(replace).toHaveBeenCalledWith(checkoutResumePath(WAITING.orderId));
  });

  it('still sends an empty cart with no waiting order to the shop', () => {
    form({});

    expect(replace).toHaveBeenCalledWith(PATHS.SHOP);
  });

  it('keeps a filled cart’s own checkout, with a note leading to the waiting order', () => {
    addToCart(
      {
        productId: 'p1',
        slug: 'cat-toy',
        title: 'اسباب‌بازی گربه',
        sku: 'SKU-1',
        unitPrice: 185_000,
      },
      1,
    );
    form({ resume: WAITING });

    expect(replace).not.toHaveBeenCalled();
    expect(
      screen.getByRole('link', { name: 'ارسال رسید' }).getAttribute('href'),
    ).toBe(checkoutResumePath(WAITING.orderId));
    // The cart's own checkout, on its first step.
    expect(screen.getByLabelText('نام و نام خانوادگی گیرنده')).toBeTruthy();
    expect(screen.getByText('اسباب‌بازی گربه')).toBeTruthy();
    expect(postData).not.toHaveBeenCalledWith(
      API_PATHS.CHECKOUT,
      expect.anything(),
      expect.anything(),
    );
  });
});
