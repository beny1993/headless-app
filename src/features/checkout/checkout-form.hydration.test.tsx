// Pins the checkout form's `useSyncExternalStore` wiring: the server snapshot
// must be `getServerCart` (unconditionally empty), so a returning shopper's cart
// arrives on the render right after hydration WITHOUT contradicting the server —
// the same hydration hazard, and the same pin, as cart-drawer.test.tsx.
//
// The summary reads the localStorage cart. If the server snapshot were `getCart`,
// the hydrating render would reproduce the browser's stored cart, which the
// server never rendered, and React would throw the server DOM away — caught here
// through `onRecoverableError`. Correct wiring hydrates in silence and the cart
// shows on the next render.
//
// Asserted on the order summary, which every step renders; `next/navigation` is
// stubbed because the form calls `useRouter`, and `@/lib/api-client` is stubbed
// so importing the form never reaches a real fetch (it is not called at render).
//
// Also pinned here: the saved-address select arrives disabled from the server
// and is enabled by the render right after hydration. A pick made before React
// listens is lost (`useHydrated`). Asserted on the DOM's `disabled`, as in
// ./retry-payment-button.test.tsx.
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutForm } from './checkout-form';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import {
  addToCart,
  clearCart,
  type CartLineInput,
} from '@/features/storefront/cart/cart';
import type { AddressResponse } from '@/lib/hono/routes/me-addresses';

const { replace } = vi.hoisted(() => ({
  replace: vi.fn<(href: string) => void>(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
}));
vi.mock('@/lib/api-client', () => ({
  postData: vi.fn(),
  ApiRequestError: class extends Error {},
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const RATES = [{ provinceId: 1, name: 'تهران', fee: 40_000 }];

const CAT_TOY: CartLineInput = {
  productId: 'p1',
  slug: 'cat-toy',
  title: 'اسباب‌بازی گربه',
  sku: 'SKU-1',
  unitPrice: 185_000,
};

/** On the one active province, as in ./checkout-form.saved-address.test.tsx. */
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

let container: HTMLDivElement;
let unmount: () => void = () => undefined;

beforeEach(() => {
  replace.mockClear();
  clearCart();
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  act(() => unmount());
  unmount = () => undefined;
  container.remove();
  clearCart();
});

describe('the checkout form, hydrating', () => {
  it('shows a returning shopper their cart without contradicting the server', () => {
    // The server has no cart, so its summary shows no line.
    const serverHtml = renderToString(
      <CheckoutForm
        rates={RATES}
        defaultName=""
        defaultPhone=""
        payment={DEFAULT_CONTENT['checkout.payment']}
      />,
    );
    expect(serverHtml).not.toContain(CAT_TOY.title);

    // The browser is holding a cart from a previous visit.
    addToCart(CAT_TOY, 2);

    container.innerHTML = serverHtml;
    const recovered: unknown[] = [];

    act(() => {
      const root = hydrateRoot(
        container,
        <CheckoutForm
          rates={RATES}
          defaultName=""
          defaultPhone=""
          payment={DEFAULT_CONTENT['checkout.payment']}
        />,
        { onRecoverableError: (error) => recovered.push(error) },
      );
      unmount = () => root.unmount();
    });

    // No mismatch: the hydrating render reproduced the server's empty cart.
    expect(recovered).toEqual([]);
    // …and the stored cart is on screen right after.
    expect(container.textContent).toContain(CAT_TOY.title);
    // It arrived in the same render as `hydrated`: a render that had one
    // without the other would send a shopper with a cart to the shop.
    expect(replace).not.toHaveBeenCalled();
  });

  it('takes a saved address only once React listens', () => {
    const form = (
      <CheckoutForm
        rates={RATES}
        defaultName=""
        defaultPhone=""
        savedAddresses={[SAVED]}
        payment={DEFAULT_CONTENT['checkout.payment']}
      />
    );
    const savedSelect = () =>
      container.querySelector<HTMLSelectElement>(
        '[data-umami-event="checkout-saved-address-select"]',
      )!;

    container.innerHTML = renderToString(form);
    expect(savedSelect().disabled).toBe(true);

    addToCart(CAT_TOY, 1);
    const recovered: unknown[] = [];
    act(() => {
      const root = hydrateRoot(container, form, {
        onRecoverableError: (error) => recovered.push(error),
      });
      unmount = () => root.unmount();
    });
    expect(recovered).toEqual([]);
    expect(savedSelect().disabled).toBe(false);

    fireEvent.change(savedSelect(), { target: { value: '0' } });
    expect(
      container.querySelector<HTMLInputElement>(
        '[data-umami-event="checkout-recipient-name"]',
      )!.value,
    ).toBe(SAVED.recipientName);
  });
});
