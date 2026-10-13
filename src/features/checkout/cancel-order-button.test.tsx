// Pins where keyboard focus goes around «لغو سفارش»'s confirm step — the
// button that was pressed disappears, so without this focus falls to <body>:
//   · opening the confirmation focuses «نه، بماند», the safe choice, inside a
//     group named by the question, so a screen reader reads it out;
//   · «نه، بماند» hands focus back to «لغو سفارش».
// And that «لغو سفارش» arrives disabled from the server, enabled by the render
// right after hydration: a tap before React listens is dropped (`useHydrated`).
// Asserted on the DOM's `disabled`, as in ./retry-payment-button.test.tsx.
//
// Mocked at the module edge only: `next/navigation` and the API client.
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CancelOrderButton } from './cancel-order-button';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/api-client', () => ({ postData: vi.fn() }));

afterEach(cleanup);

// `hydrateRoot` inside `act()` needs this. RTL's own calls set it for
// themselves, but the hydration case below drives React's client API directly.
// React does not declare the flag on `globalThis`, hence the cast.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

describe('CancelOrderButton, hydrating', () => {
  let container: HTMLDivElement;
  let unmount: () => void = () => undefined;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
  });

  afterEach(() => {
    act(() => unmount());
    unmount = () => undefined;
    container.remove();
  });

  const openButton = () =>
    container.querySelector<HTMLButtonElement>(
      '[data-umami-event="account-order-cancel"]',
    )!;

  it('arrives disabled and opens the question once React listens', () => {
    container.innerHTML = renderToString(
      <CancelOrderButton orderId={ORDER_ID} />,
    );
    expect(openButton().disabled).toBe(true);

    const recovered: unknown[] = [];
    act(() => {
      const root = hydrateRoot(
        container,
        <CancelOrderButton orderId={ORDER_ID} />,
        { onRecoverableError: (error) => recovered.push(error) },
      );
      unmount = () => root.unmount();
    });
    expect(recovered).toEqual([]);
    expect(openButton().disabled).toBe(false);

    fireEvent.click(openButton());
    expect(
      screen.queryByRole('button', { name: 'بله، لغو کن' }),
    ).not.toBeNull();
  });
});
