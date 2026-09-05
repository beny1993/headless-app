// Pins the transition control's wiring — the part no unit test reaches:
//   · the offered buttons are DERIVED from the `status` prop (adminNextStatuses),
//     so a status change re-renders new buttons rather than reading a stale local
//     copy. Revert to `useState(status)` and the "follows the prop" test fails.
//   · a click POSTs `{ to }` to the transitions endpoint and, on success, calls
//     router.refresh() — never tracking the new status itself.
//   · a terminal order offers nothing.
//
// Mocked at the module edge only: `next/navigation` (refresh is a recorder) and
// `@/lib/api-client` (postData is a recorder). The derivation runs for real.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiAdminOrderTransitionsPath } from '@/lib/constant/paths';
import { ORDER_STATUSES } from '@/lib/orders/order-status';
import { OrderTransition } from './order-transition';

const { refresh, postData } = vi.hoisted(() => ({
  refresh: vi.fn(),
  postData: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/api-client', () => ({ postData }));

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

  it('shows the server message and does not refresh when the transition is rejected', async () => {
    postData.mockRejectedValue(new Error('این تغییر وضعیت مجاز نیست'));
    render(<OrderTransition orderId={ORDER_ID} status={ORDER_STATUSES.PAID} />);

    fireEvent.click(screen.getByRole('button', { name: /لغو سفارش/ }));
    await act(async () => {});

    expect(screen.getByRole('alert').textContent).toContain(
      'این تغییر وضعیت مجاز نیست',
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
