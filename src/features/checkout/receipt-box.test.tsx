// Pins the receipt box's wiring — what no unit test of its rules can see:
//   · the picked file's NAME never renders (a phone names a screenshot
//     `IMG_20260930_1412.jpg`, and a shopper's page shows no ASCII digit — nor
//     anyone's file names);
//   · an upload posts the file to the order's receipt route and then asks the
//     server to re-render, clearing what it picked — and never leaves the
//     control stuck busy, since `router.refresh()` keeps this component
//     mounted (the lesson `order-transition.test.tsx` pins);
//   · a refusal shows the server's Persian sentence; a 409 (the order moved on
//     under the shopper) also re-renders the box from the server — and the
//     cap's 409 leaves its sentence to the re-rendered box, so it shows once;
//   · what the box offers follows the status it is given.
//
// Mocked at the module edge only: `next/navigation` (refresh is a recorder)
// and `@/lib/api-client`'s `postForm` (a recorder; `ApiRequestError` stays
// real). The rules — accept list, cap, labels — run for real.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api-client';
import {
  apiOrderReceiptPath,
  apiOrderReceiptsPath,
} from '@/lib/constant/paths';
import { ORDER_STATUSES, type OrderStatus } from '@/lib/orders/order-status';
import {
  RECEIPT_CAP_MESSAGE,
  RECEIPT_FORMAT_HINT,
  receiptSchema,
} from '@/lib/orders/receipt';
import { IMAGE_FIELD_NAME, IMAGE_TYPE_ERROR } from '@/lib/storage/image-upload';
import { ReceiptBox } from './receipt-box';

const { refresh, postForm } = vi.hoisted(() => ({
  refresh: vi.fn(),
  postForm: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  postForm,
}));

afterEach(() => {
  cleanup();
  refresh.mockReset();
  postForm.mockReset();
});

const ORDER_ID = '11111111-1111-1111-1111-111111111111';
const PREFIX = 'account-order';
const receipt = (n: number) => ({
  id: `2222222${n}-2222-2222-2222-222222222222`,
  uploadedAt: '۸ مهر ۱۴۰۵',
});

const box = (
  status: OrderStatus,
  receipts: { id: string; uploadedAt: string }[] = [],
) => (
  <ReceiptBox
    orderId={ORDER_ID}
    orderStatus={status}
    receipts={receipts}
    eventPrefix={PREFIX}
  />
);

const picker = () =>
  document.querySelector<HTMLInputElement>(
    `[data-umami-event="${PREFIX}-receipt-file"]`,
  );
const uploadButton = () =>
  document.querySelector<HTMLButtonElement>(
    `[data-umami-event="${PREFIX}-receipt-upload"]`,
  );
const pick = (file: File) =>
  fireEvent.change(picker()!, { target: { files: [file] } });

const screenshot = () =>
  new File(
    [new Uint8Array([0xff, 0xd8, 0xff, 0xe0])],
    'IMG_20260930_1412.jpg',
    {
      type: 'image/jpeg',
    },
  );

describe('ReceiptBox', () => {
  it('asks a waiting order for its receipt, with the picker and the hint', () => {
    render(box(ORDER_STATUSES.AWAITING_RECEIPT));

    expect(
      screen.getByText(
        'هنوز رسیدی دریافت نشده است. پس از واریز، رسید را همین‌جا بارگذاری کن.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(RECEIPT_FORMAT_HINT)).toBeTruthy();
    expect(picker()).not.toBeNull();
    // Nothing to send until a file is picked.
    expect(uploadButton()!.disabled).toBe(true);
  });

  it('says a file was picked without ever showing its name', () => {
    render(box(ORDER_STATUSES.AWAITING_RECEIPT));

    pick(screenshot());

    expect(screen.getByText('یک تصویر انتخاب شد')).toBeTruthy();
    expect(document.body.textContent).not.toContain('IMG_20260930_1412');
    expect(document.body.textContent).not.toMatch(/\d/);
    expect(uploadButton()!.disabled).toBe(false);
  });

  it('refuses a file that is not an image before sending anything', () => {
    render(box(ORDER_STATUSES.AWAITING_RECEIPT));

    pick(new File(['%PDF'], 'receipt.pdf', { type: 'application/pdf' }));

    expect(screen.getByText(IMAGE_TYPE_ERROR)).toBeTruthy();
    expect(uploadButton()!.disabled).toBe(true);
    expect(postForm).not.toHaveBeenCalled();
  });

  it('posts the file to the order’s receipt route, then re-renders from the server', async () => {
    postForm.mockResolvedValue({ id: receipt(1).id, createdAt: 'x' });
    const view = render(box(ORDER_STATUSES.AWAITING_RECEIPT));
    const file = screenshot();

    pick(file);
    fireEvent.click(uploadButton()!);
    await act(async () => {});

    expect(postForm).toHaveBeenCalledTimes(1);
    const [path, form, schema] = postForm.mock.calls[0] as [
      string,
      FormData,
      unknown,
    ];
    expect(path).toBe(apiOrderReceiptsPath(ORDER_ID));
    expect(form.get(IMAGE_FIELD_NAME)).toBe(file);
    expect(schema).toBe(receiptSchema);
    expect(refresh).toHaveBeenCalledTimes(1);

    // The refresh lands: accepted, one receipt. The pick is gone and the
    // control is not left busy — a second receipt can be picked and sent.
    view.rerender(box(ORDER_STATUSES.PROCESSING, [receipt(1)]));
    expect(screen.queryByText('یک تصویر انتخاب شد')).toBeNull();
    pick(screenshot());
    expect(uploadButton()!.disabled).toBe(false);
  });

  it('shows the server’s own sentence for a 409, then re-renders from the order as it now is', async () => {
    // A 409 means the order moved on under the shopper — shipped or cancelled —
    // so the box must stop offering what it no longer takes.
    const message = 'این سفارش رسید نمی‌پذیرد.';
    postForm.mockRejectedValue(new ApiRequestError(409, message));
    render(box(ORDER_STATUSES.AWAITING_RECEIPT));

    pick(screenshot());
    fireEvent.click(uploadButton()!);
    await act(async () => {});

    expect(screen.getByText(message)).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('says the cap once when a 409 finds the order full — the refreshed box says it', async () => {
    // Another tab filled the order: the 409 carries the cap's sentence, and the
    // refreshed box, now holding every receipt, shows that sentence itself.
    postForm.mockRejectedValue(new ApiRequestError(409, RECEIPT_CAP_MESSAGE));
    const view = render(
      box(
        ORDER_STATUSES.PROCESSING,
        [1, 2, 3, 4].map((n) => receipt(n)),
      ),
    );

    pick(screenshot());
    fireEvent.click(uploadButton()!);
    await act(async () => {});
    expect(refresh).toHaveBeenCalledTimes(1);

    view.rerender(
      box(
        ORDER_STATUSES.PROCESSING,
        [1, 2, 3, 4, 5].map((n) => receipt(n)),
      ),
    );
    expect(screen.getAllByText(RECEIPT_CAP_MESSAGE)).toHaveLength(1);
  });

  it('shows the server’s own sentence for a 503 and refreshes nothing', async () => {
    // Nothing about the order changed; the same file can be sent again later.
    const message =
      'بارگذاری رسید موقتاً ممکن نیست؛ رسید را از طریق اینستاگرام یا تلگرام بفرست.';
    postForm.mockRejectedValue(new ApiRequestError(503, message));
    render(box(ORDER_STATUSES.AWAITING_RECEIPT));

    pick(screenshot());
    fireEvent.click(uploadButton()!);
    await act(async () => {});

    expect(screen.getByText(message)).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    // Not stuck: the same file can be sent again.
    expect(uploadButton()!.disabled).toBe(false);
  });

  it('lists each receipt as a plain image through the owner’s route', () => {
    render(box(ORDER_STATUSES.PROCESSING, [receipt(1), receipt(2)]));

    const links = document.querySelectorAll<HTMLAnchorElement>(
      `[data-umami-event="${PREFIX}-receipt-open"]`,
    );
    expect(links).toHaveLength(2);
    const url = apiOrderReceiptPath(ORDER_ID, receipt(1).id);
    expect(links[0].getAttribute('href')).toBe(url);
    expect(links[0].getAttribute('target')).toBe('_blank');
    // Plain <img>, never next/image: the optimizer would cache and re-serve it.
    expect(links[0].querySelector('img')?.getAttribute('src')).toBe(url);
    expect(screen.getByText('دریافت شد؛ در حال بررسی')).toBeTruthy();
    expect(
      screen.getByText(
        'رسید دریافت شد و سفارش پذیرفته شد؛ پس از بررسی رسید، ارسال می‌شود.',
      ),
    ).toBeTruthy();
  });

  it('invites a receipt for an order accepted by hand, with none uploaded', () => {
    render(box(ORDER_STATUSES.PROCESSING));
    expect(
      screen.getByText(
        'سفارش پذیرفته شد؛ رسید را می‌توانی همین‌جا بارگذاری کنی.',
      ),
    ).toBeTruthy();
    expect(picker()).not.toBeNull();
  });

  it('offers no picker at the cap, pointing to support instead', () => {
    render(
      box(
        ORDER_STATUSES.PROCESSING,
        [1, 2, 3, 4, 5].map((n) => receipt(n)),
      ),
    );
    expect(picker()).toBeNull();
    expect(screen.getByText(RECEIPT_CAP_MESSAGE)).toBeTruthy();
  });

  it('keeps the receipts of a cancelled order on view, marked rejected, with no picker', () => {
    render(box(ORDER_STATUSES.CANCELLED, [receipt(1)]));
    expect(picker()).toBeNull();
    expect(screen.getByText('رد شده')).toBeTruthy();
  });
});
