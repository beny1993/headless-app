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
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutForm } from './checkout-form';
import {
  addToCart,
  clearCart,
  type CartLineInput,
} from '@/features/storefront/cart/cart';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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

let container: HTMLDivElement;
let unmount: () => void = () => undefined;

beforeEach(() => {
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
      <CheckoutForm rates={RATES} defaultName="" defaultPhone="" />,
    );
    expect(serverHtml).not.toContain(CAT_TOY.title);

    // The browser is holding a cart from a previous visit.
    addToCart(CAT_TOY, 2);

    container.innerHTML = serverHtml;
    const recovered: unknown[] = [];

    act(() => {
      const root = hydrateRoot(
        container,
        <CheckoutForm rates={RATES} defaultName="" defaultPhone="" />,
        { onRecoverableError: (error) => recovered.push(error) },
      );
      unmount = () => root.unmount();
    });

    // No mismatch: the hydrating render reproduced the server's empty cart.
    expect(recovered).toEqual([]);
    // …and the stored cart is on screen right after.
    expect(container.textContent).toContain(CAT_TOY.title);
  });
});
