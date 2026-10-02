// Pins the card-to-card checkout's receipt wiring — a file held across an
// async create, and a button that must never come back once an order exists.
// Each property was verified by putting its bug back and watching this fail:
//   · «ثبت سفارش» stays locked until a screenshot that passes the byte check
//     is attached, and locks again when a later pick is refused;
//   · one click creates the order, clears the cart, stores the screenshot and
//     only then opens the order's result page;
//   · once the create has answered 2xx, nothing re-enables the button: a
//     screenshot that fails to store lands the shopper on that order's own
//     page, and a second click sends no second create;
//   · a refused card-to-card checkout says how to get a transfer back;
//   · the address book is written after the screenshot, and its failure still
//     navigates.
//
// Mocked at the module edge only: `next/navigation` (router recorder) and
// `@/lib/api-client`'s `postData` and `postForm` (recorders; the real
// `ApiRequestError` is kept). The cart store and the receipt byte check run
// for real. Harness as in ./checkout-form.submit.test.tsx.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutForm } from './checkout-form';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import { addToCart, clearCart, getCart } from '@/features/storefront/cart/cart';
import { ApiRequestError } from '@/lib/api-client';
import { REFUND_SENTENCE } from '@/lib/checkout/result-view';
import { API_PATHS, apiOrderReceiptsPath } from '@/lib/constant/paths';
import {
  MAX_RECEIPT_BYTES,
  RECEIPT_SIZE_ERROR,
  receiptSchema,
} from '@/lib/orders/receipt';
import { IMAGE_FIELD_NAME, IMAGE_TYPE_ERROR } from '@/lib/storage/image-upload';

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

/** What `POST /api/checkout` answers for a card-to-card order. */
const CREATED = {
  orderId: 'order-123',
  orderNo: 10_046,
  status: 'awaiting_receipt',
  subtotal: 370_000,
  shippingFee: 40_000,
  discount: 0,
  total: 410_000,
};
const RESULT_PAGE = '/checkout/result/order-123';
const STORED = {
  id: '22222222-2222-2222-2222-222222222222',
  createdAt: '2026-10-02T09:30:00.000Z',
};

/** Fills the first two steps with valid input and lands on the payment step. */
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

const chooseCardToCard = () =>
  fireEvent.click(screen.getByRole('radio', { name: /کارت به کارت/ }));

const submitButton = () =>
  screen.getByRole('button', { name: /ثبت سفارش|در حال/ }) as HTMLButtonElement;

const receiptInput = () =>
  document.querySelector<HTMLInputElement>(
    '[data-umami-event="checkout-receipt-file"]',
  );

/** Attaches `file` and lets its byte check settle, as the browser would. */
const attach = async (file: File) => {
  await act(async () => {
    fireEvent.change(receiptInput()!, { target: { files: [file] } });
  });
};

/** A phone's screenshot: a JPEG by its bytes, named by its timestamp. */
const screenshot = () =>
  new File(
    [new Uint8Array([0xff, 0xd8, 0xff, 0xe0])],
    'IMG_20261002_0930.jpg',
    {
      type: 'image/jpeg',
    },
  );

const click = async () => {
  await act(async () => {
    fireEvent.click(submitButton());
  });
};

/** The picker's own alert, and the form's top one. */
const receiptAlert = () => document.querySelector('[id$="-receipt-error"]');
const topAlert = () => document.querySelector('[id$="-top-error"]');

/** The creates sent — `postData` also carries the address book's save. */
const creates = () =>
  postData.mock.calls.filter(([path]) => path === API_PATHS.CHECKOUT);

beforeEach(() => {
  clearCart();
  addToCart(
    {
      productId: 'p1',
      slug: 'cat-toy',
      title: 'اسباب‌بازی گربه',
      sku: 'SKU-1',
      unitPrice: 185_000,
    },
    2,
  );
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

describe('the card-to-card checkout and its screenshot', () => {
  it('keeps «ثبت سفارش» locked until a screenshot that passes the byte check is attached', async () => {
    advanceToPayment();
    chooseCardToCard();
    expect(submitButton().disabled).toBe(true);

    await attach(screenshot());
    expect(submitButton().disabled).toBe(false);
    expect(screen.getByText('یک تصویر انتخاب شد')).toBeTruthy();
    expect(document.body.textContent).not.toContain('IMG_20261002');

    // A PDF renamed .jpg and declared a JPEG: refused by its bytes, inline,
    // and the button locks again.
    await attach(new File(['%PDF-1.4'], 'receipt.jpg', { type: 'image/jpeg' }));
    expect(receiptAlert()?.textContent).toBe(IMAGE_TYPE_ERROR);
    expect(submitButton().disabled).toBe(true);

    // One byte over the cap: refused as too large, still locked.
    await attach(
      new File(
        [new Uint8Array([0xff, 0xd8, 0xff]), new Uint8Array(MAX_RECEIPT_BYTES)],
        'receipt.jpg',
        { type: 'image/jpeg' },
      ),
    );
    expect(receiptAlert()?.textContent).toBe(RECEIPT_SIZE_ERROR);
    expect(submitButton().disabled).toBe(true);

    await click();
    expect(postData).not.toHaveBeenCalled();
  });

  it('asks a Zarinpal checkout for no screenshot', () => {
    advanceToPayment(); // Zarinpal is the default method

    expect(receiptInput()).toBeNull();
    expect(submitButton().disabled).toBe(false);
  });

  it('places the order, stores its screenshot, then opens its result page — in one click', async () => {
    postData.mockResolvedValue(CREATED);
    let cartDuringUpload: number | undefined;
    let stored = () => {};
    postForm.mockImplementation(() => {
      cartDuringUpload = getCart().length;
      return new Promise((resolve) => (stored = () => resolve(STORED)));
    });
    advanceToPayment();
    chooseCardToCard();
    const file = screenshot();
    await attach(file);

    await click();

    // The order exists and its screenshot is on its way: the cart is already
    // gone, the button says so, and nothing has navigated yet.
    expect(cartDuringUpload).toBe(0);
    expect(submitButton().textContent).toBe('در حال ارسال رسید…');
    expect(submitButton().disabled).toBe(true);
    expect(push).not.toHaveBeenCalled();

    const [path, form, schema] = postForm.mock.calls[0] as [
      string,
      FormData,
      unknown,
    ];
    expect(path).toBe(apiOrderReceiptsPath('order-123'));
    expect(form.get(IMAGE_FIELD_NAME)).toBe(file);
    expect(schema).toBe(receiptSchema);

    await act(async () => stored());

    expect(push).toHaveBeenCalledWith(RESULT_PAGE);
    expect(postData.mock.invocationCallOrder[0]).toBeLessThan(
      postForm.mock.invocationCallOrder[0],
    );
    expect(postForm.mock.invocationCallOrder[0]).toBeLessThan(
      push.mock.invocationCallOrder[0],
    );
  });

  it.each([
    [
      'the server refuses to store it',
      () =>
        new ApiRequestError(
          503,
          'بارگذاری رسید موقتاً ممکن نیست؛ رسید را از طریق اینستاگرام یا تلگرام بفرست.',
        ),
    ],
    ['the connection drops', () => new TypeError('Failed to fetch')],
  ])('never places a second order when %s', async (_, failure) => {
    postData.mockResolvedValue(CREATED);
    postForm.mockRejectedValue(failure());
    advanceToPayment();
    chooseCardToCard();
    await attach(screenshot());

    await click();
    // The shopper tries again: no second create.
    await click();
    expect(creates()).toHaveLength(1);

    // On to the order's own page, which shows it waiting and takes the
    // upload again — never back to a form that would create another.
    expect(push).toHaveBeenCalledWith(RESULT_PAGE);
    expect(submitButton().disabled).toBe(true);
    // The emptied cart never sent the form to the shop instead.
    expect(replace).not.toHaveBeenCalled();
  });

  it('tells a card-to-card shopper the server refused how to get a transfer back', async () => {
    postData.mockRejectedValue(
      new ApiRequestError(422, 'ورودی نامعتبر', [
        'paymentMethod: تعداد سفارش‌های در انتظار پرداختِ شما به حد مجاز رسیده است؛ لطفاً یکی را کامل یا لغو کنید.',
      ]),
    );
    advanceToPayment();
    chooseCardToCard();
    await attach(screenshot());

    await click();

    expect(topAlert()?.textContent).toContain('به حد مجاز رسیده است');
    expect(topAlert()?.textContent).toContain(REFUND_SENTENCE);
    // Nothing was created, so nothing is stored and the form stays usable.
    expect(postForm).not.toHaveBeenCalled();
    expect(submitButton().disabled).toBe(false);
    expect(getCart()).toHaveLength(1);
  });

  it('says it beside an inline field error too, where the alert had nothing else to say', async () => {
    postData.mockRejectedValue(
      new ApiRequestError(400, 'ورودی نامعتبر است', [
        'address.city: مقدار واردشده بیش از حد طولانی است.',
      ]),
    );
    advanceToPayment();
    chooseCardToCard();
    await attach(screenshot());

    await click();

    // Back on the address step, the field's own message inline…
    expect(
      screen.getByText('مقدار واردشده بیش از حد طولانی است.'),
    ).toBeTruthy();
    // …and the way back to a transfer above it.
    expect(topAlert()?.textContent).toBe(REFUND_SENTENCE);
  });

  it('says nothing about a transfer to a Zarinpal shopper', async () => {
    postData.mockRejectedValue(
      new ApiRequestError(422, 'ورودی نامعتبر', [
        'paymentMethod: تعداد سفارش‌های در انتظار پرداختِ شما به حد مجاز رسیده است؛ لطفاً یکی را کامل یا لغو کنید.',
      ]),
    );
    advanceToPayment(); // Zarinpal

    await click();

    expect(topAlert()?.textContent).toContain('به حد مجاز رسیده است');
    expect(topAlert()?.textContent).not.toContain(REFUND_SENTENCE);
  });

  it('saves the address only after the screenshot, and still navigates when that save fails', async () => {
    postData.mockImplementation((path: string) =>
      path === API_PATHS.CHECKOUT
        ? Promise.resolve(CREATED)
        : Promise.reject(
            new ApiRequestError(422, 'به سقف تعداد آدرس‌ها رسیده‌ای.'),
          ),
    );
    postForm.mockResolvedValue(STORED);
    advanceToPayment({ saveAddress: true });
    chooseCardToCard();
    await attach(screenshot());

    await click();

    const save = postData.mock.calls.findIndex(
      ([path]) => path === API_PATHS.ME_ADDRESSES,
    );
    expect(save).toBeGreaterThan(-1);
    expect(postForm.mock.invocationCallOrder[0]).toBeLessThan(
      postData.mock.invocationCallOrder[save],
    );
    expect(push).toHaveBeenCalledWith(RESULT_PAGE);
  });
});
