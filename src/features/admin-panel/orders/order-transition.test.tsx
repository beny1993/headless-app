// Pins the transition control's wiring — the part no unit test reaches:
//   · the offered buttons are DERIVED from the `status` prop (adminNextStatuses),
//     so a status change re-renders new buttons rather than reading a stale local
//     copy. Revert to `useState(status)` and the "follows the prop" test fails.
//   · a click POSTs `{ to }` to the transitions endpoint and, on success, calls
//     router.refresh() — never tracking the new status itself.
//   · a terminal order offers nothing.
//
// Mocked at the module edge only: `next/navigation` (refresh is a recorder) and
// `@/lib/api-client` (postData is a recorder; `ApiRequestError` stays real),
// plus `sonner`'s `toast`, where a refused transition is reported. The
// derivation runs for real.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api-client';
import { apiAdminOrderTransitionsPath } from '@/lib/constant/paths';
import {
  CANCELLATION_REASON_MAX,
  CANCELLATION_REASON_REQUIRED_MESSAGE,
  ORDER_STATUSES,
} from '@/lib/orders/order-status';
import { OrderTransition } from './order-transition';

const { refresh, postData, toast } = vi.hoisted(() => ({
  refresh: vi.fn(),
  postData: vi.fn(),
  toast: { error: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  postData,
}));
vi.mock('sonner', () => ({ toast }));

const ORDER_ID = '11111111-1111-1111-1111-111111111111';

/** The `to` values offered, read off each button's umami event. */
const offeredTargets = () =>
  Array.from(document.querySelectorAll('button'))
    .map((b) => b.getAttribute('data-umami-event'))
    .filter(
      (e): e is string => !!e?.startsWith('admin-panel-order-transition-'),
    )
    .map((e) => e.replace('admin-panel-order-transition-', ''));

afterEach(() => {
  cleanup();
  refresh.mockReset();
  postData.mockReset();
  toast.error.mockReset();
});

describe('OrderTransition', () => {
  it('offers exactly the admin next states for the current status', () => {
    render(<OrderTransition orderId={ORDER_ID} status={ORDER_STATUSES.PAID} />);
    expect(offeredTargets().sort()).toEqual(
      [ORDER_STATUSES.PROCESSING, ORDER_STATUSES.CANCELLED].sort(),
    );
  });

  it('follows the status prop when it changes — no stale local copy', () => {
    // The pin: derived-from-prop, not `useState(status)`. A paid order offers
    // {processing, cancelled}; re-rendered as shipped it must offer {delivered}.
    const view = render(
      <OrderTransition orderId={ORDER_ID} status={ORDER_STATUSES.PAID} />,
    );
    expect(offeredTargets().sort()).toEqual(
      [ORDER_STATUSES.PROCESSING, ORDER_STATUSES.CANCELLED].sort(),
    );

    view.rerender(
      <OrderTransition orderId={ORDER_ID} status={ORDER_STATUSES.SHIPPED} />,
    );
    expect(offeredTargets()).toEqual([ORDER_STATUSES.DELIVERED]);
  });

  it('offers nothing for a terminal order', () => {
    render(
      <OrderTransition orderId={ORDER_ID} status={ORDER_STATUSES.DELIVERED} />,
    );
    expect(offeredTargets()).toEqual([]);
    expect(screen.getByText(/وضعیت نهایی/)).toBeTruthy();
  });

  it('POSTs the chosen target then refreshes on success', async () => {
    postData.mockResolvedValue({});
    render(<OrderTransition orderId={ORDER_ID} status={ORDER_STATUSES.PAID} />);

    fireEvent.click(screen.getByRole('button', { name: /در حال پردازش/ }));
    await act(async () => {});

    expect(postData).toHaveBeenCalledWith(
      apiAdminOrderTransitionsPath(ORDER_ID),
      { to: ORDER_STATUSES.PROCESSING },
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('re-enables the next status buttons after a successful transition', async () => {
    // The pin for the refresh-preserves-state bug: `router.refresh()` keeps this
    // client component mounted (state survives), so if `busy` were left set after
    // success, the newly-rendered buttons would stay disabled and the admin could
    // not chain paid → processing → shipped without a reload. Simulate the round
    // trip: click, resolve, then re-render with the order's new status.
    postData.mockResolvedValue({});
    const view = render(
      <OrderTransition orderId={ORDER_ID} status={ORDER_STATUSES.PAID} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /در حال پردازش/ }));
    await act(async () => {});

    // The server refresh lands: the control is re-rendered with the new status.
    view.rerender(
      <OrderTransition orderId={ORDER_ID} status={ORDER_STATUSES.PROCESSING} />,
    );

    const shipButton = screen.getByRole('button', {
      name: /ارسال شده/,
    }) as HTMLButtonElement;
    expect(shipButton.disabled).toBe(false);
  });

  it('reports a rejected transition as an error toast and does not refresh', async () => {
    postData.mockRejectedValue(
      new ApiRequestError(409, 'این تغییر وضعیت مجاز نیست'),
    );
    render(<OrderTransition orderId={ORDER_ID} status={ORDER_STATUSES.PAID} />);

    fireEvent.click(screen.getByRole('button', { name: /در حال پردازش/ }));
    await act(async () => {});

    expect(toast.error).toHaveBeenCalledWith('این تغییر وضعیت مجاز نیست');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('offers a waiting card-to-card order acceptance by hand, or a cancel', () => {
    render(
      <OrderTransition
        orderId={ORDER_ID}
        status={ORDER_STATUSES.AWAITING_RECEIPT}
      />,
    );
    expect(offeredTargets().sort()).toEqual(
      [ORDER_STATUSES.PROCESSING, ORDER_STATUSES.CANCELLED].sort(),
    );
  });

  describe('cancelling', () => {
    const reasonField = () =>
      document.querySelector<HTMLInputElement>(
        '[data-umami-event="admin-panel-order-cancel-reason"]',
      );
    const submit = () =>
      document.querySelector<HTMLButtonElement>(
        '[data-umami-event="admin-panel-order-cancel-submit"]',
      )!;
    const openCancel = () =>
      fireEvent.click(screen.getByRole('button', { name: /لغو سفارش/ }));

    it('asks for the reason first — the cancel button alone sends nothing', () => {
      render(
        <OrderTransition
          orderId={ORDER_ID}
          status={ORDER_STATUSES.PROCESSING}
        />,
      );
      expect(reasonField()).toBeNull();

      openCancel();

      expect(reasonField()).not.toBeNull();
      expect(postData).not.toHaveBeenCalled();
    });

    it('refuses to send a cancel with no reason, saying so in Persian', async () => {
      render(
        <OrderTransition
          orderId={ORDER_ID}
          status={ORDER_STATUSES.PROCESSING}
        />,
      );
      openCancel();
      fireEvent.change(reasonField()!, { target: { value: '   ' } });
      fireEvent.click(submit());
      await act(async () => {});

      expect(
        screen.getByText(CANCELLATION_REASON_REQUIRED_MESSAGE),
      ).toBeTruthy();
      expect(postData).not.toHaveBeenCalled();
    });

    it('refuses a reason carrying a bidi control before sending it', async () => {
      render(
        <OrderTransition
          orderId={ORDER_ID}
          status={ORDER_STATUSES.PROCESSING}
        />,
      );
      openCancel();
      fireEvent.change(reasonField()!, {
        target: { value: `دلیل${String.fromCharCode(0x202e)}` },
      });
      fireEvent.click(submit());
      await act(async () => {});

      expect(screen.getByText('مقدار واردشده نامعتبر است.')).toBeTruthy();
      expect(postData).not.toHaveBeenCalled();
    });

    it('sends the trimmed reason with the cancel, then re-renders from the server', async () => {
      postData.mockResolvedValue({});
      const view = render(
        <OrderTransition
          orderId={ORDER_ID}
          status={ORDER_STATUSES.AWAITING_RECEIPT}
        />,
      );
      openCancel();
      fireEvent.change(reasonField()!, {
        target: { value: '  رسیدی نرسید  ' },
      });
      fireEvent.click(submit());
      await act(async () => {});

      expect(postData).toHaveBeenCalledWith(
        apiAdminOrderTransitionsPath(ORDER_ID),
        { to: ORDER_STATUSES.CANCELLED, reason: 'رسیدی نرسید' },
      );
      expect(refresh).toHaveBeenCalledTimes(1);

      // The refresh lands: cancelled is terminal, and nothing is left open.
      view.rerender(
        <OrderTransition
          orderId={ORDER_ID}
          status={ORDER_STATUSES.CANCELLED}
        />,
      );
      expect(reasonField()).toBeNull();
      expect(screen.getByText(/وضعیت نهایی/)).toBeTruthy();
    });

    it('caps the field at the reason limit', () => {
      render(
        <OrderTransition
          orderId={ORDER_ID}
          status={ORDER_STATUSES.PROCESSING}
        />,
      );
      openCancel();
      expect(reasonField()!.maxLength).toBe(CANCELLATION_REASON_MAX);
    });

    it('tells the admin the reason is shown to the customer', () => {
      render(
        <OrderTransition
          orderId={ORDER_ID}
          status={ORDER_STATUSES.PROCESSING}
        />,
      );
      expect(
        screen.getByText(/دلیل برای مشتری نمایش داده می‌شود/),
      ).toBeTruthy();
    });
  });
});
