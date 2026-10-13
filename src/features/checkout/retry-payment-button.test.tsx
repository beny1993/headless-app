// Pins that «تلاش دوباره برای پرداخت» cannot be pressed before React listens
// to it. The result page is server-rendered around this one client button, so
// its HTML is on screen before hydration, and a tap in that window is dropped
// (see `useHydrated`). The button must arrive disabled, and be enabled by the
// render right after hydration.
//
// Hydrated the way the browser does it: the server's HTML first, then
// `hydrateRoot` over it. Asserted on the DOM's `disabled`, not on React's
// errors: an attribute that differs between the server and the hydrating render
// is never a recoverable error, React only logs it and keeps the server's — a
// button stuck disabled. `onRecoverableError` still guards the rest.
//
// Mocked at the module edge only: `startZarinpalPayment`, which would leave
// for the gateway, never settles here, so the button stays busy.
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetryPaymentButton } from './retry-payment-button';

const { startZarinpalPayment } = vi.hoisted(() => ({
  startZarinpalPayment: vi.fn<(orderId: string) => Promise<void>>(
    () => new Promise(() => undefined),
  ),
}));
vi.mock('@/lib/checkout/start-zarinpal-payment', () => ({
  startZarinpalPayment,
}));

// `hydrateRoot` inside `act()` needs this; RTL sets it for us elsewhere, but
// this file drives React's client API directly. React does not declare the flag
// on `globalThis`, hence the cast.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ORDER_ID = '11111111-1111-1111-1111-111111111111';

let container: HTMLDivElement;
let unmount: () => void = () => undefined;

beforeEach(() => {
  startZarinpalPayment.mockClear();
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  act(() => unmount());
  unmount = () => undefined;
  container.remove();
});

const retryButton = () =>
  container.querySelector<HTMLButtonElement>(
    '[data-umami-event="checkout-result-retry-pay"]',
  )!;

describe('RetryPaymentButton, hydrating', () => {
  it('arrives disabled and takes a tap once React listens', () => {
    container.innerHTML = renderToString(
      <RetryPaymentButton orderId={ORDER_ID} />,
    );
    expect(retryButton().disabled).toBe(true);

    const recovered: unknown[] = [];
    act(() => {
      const root = hydrateRoot(
        container,
        <RetryPaymentButton orderId={ORDER_ID} />,
        { onRecoverableError: (error) => recovered.push(error) },
      );
      unmount = () => root.unmount();
    });
    expect(recovered).toEqual([]);
    expect(retryButton().disabled).toBe(false);

    fireEvent.click(retryButton());
    expect(startZarinpalPayment).toHaveBeenCalledExactlyOnceWith(ORDER_ID);
    expect(retryButton().textContent).toContain('در حال انتقال…');
  });
});
