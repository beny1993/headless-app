// Pins where keyboard focus goes around «لغو سفارش»'s confirm step — the
// button that was pressed disappears, so without this focus falls to <body>:
//   · opening the confirmation focuses «نه، بماند», the safe choice, inside a
//     group named by the question, so a screen reader reads it out;
//   · «نه، بماند» hands focus back to «لغو سفارش».
//
// Mocked at the module edge only: `next/navigation` and the API client.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CancelOrderButton } from './cancel-order-button';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/api-client', () => ({ postData: vi.fn() }));

afterEach(cleanup);

const ORDER_ID = '11111111-1111-1111-1111-111111111111';

describe('CancelOrderButton', () => {
  it('moves focus to the safe choice of a confirmation that is read out', () => {
    render(<CancelOrderButton orderId={ORDER_ID} />);

    fireEvent.click(screen.getByRole('button', { name: /لغو سفارش/ }));

    const group = screen.getByRole('group', {
      name: 'این سفارش لغو شود؟ اقلام آن به فروشگاه برمی‌گردند.',
    });
    const keep = screen.getByRole('button', { name: 'نه، بماند' });
    expect(group.contains(keep)).toBe(true);
    expect(document.activeElement).toBe(keep);
  });

  it('hands focus back to «لغو سفارش» when the shopper keeps the order', () => {
    render(<CancelOrderButton orderId={ORDER_ID} />);
    fireEvent.click(screen.getByRole('button', { name: /لغو سفارش/ }));

    fireEvent.click(screen.getByRole('button', { name: 'نه، بماند' }));

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /لغو سفارش/ }),
    );
  });
});
