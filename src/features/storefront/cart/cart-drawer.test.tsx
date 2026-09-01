// Pins the drawer's `useSyncExternalStore` wiring: the **server snapshot** must
// be `getServerCart` (unconditionally empty), never `getCart`.
//
// Why a component test and not a unit test: `getServerCart`'s own unit test can
// only prove that the function returns an empty array, which `getCart` also
// does on the server. It says nothing about which of the two the component
// hands React — so swapping them back, the bug that shipped, passes every unit
// test in the repo. The mistake is only observable where the two disagree: on
// the *client*, during hydration, with a cart already in localStorage. React
// calls the server snapshot a second time there, and `getCart` answers with the
// stored cart — a badge the server never rendered.
//
// So the test reproduces exactly that: server HTML from an empty cart, a
// populated store, then a real `hydrateRoot`. Correct wiring hydrates in
// silence and shows the cart on the render immediately after. The revert makes
// React recover from a mismatch, which `onRecoverableError` catches.
//
// Deliberately asserted on the navbar button and its badge, which live outside
// the `<dialog>` — no `showModal()`, so the pin does not rest on happy-dom's
// partial dialog implementation.
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CartDrawer } from './cart-drawer';
import { addToCart, clearCart, type CartLineInput } from './cart';

// `hydrateRoot` inside `act()` needs this; RTL sets it for us elsewhere, but
// this file drives React's client API directly. React does not declare the flag
// on `globalThis`, hence the cast.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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
  // Empties the module's in-memory cache as well as the store — a stale cache
  // would let the server render disagree with the browser for the wrong reason.
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

describe('the cart drawer, hydrating', () => {
  it('shows a returning shopper their cart without contradicting the server', () => {
    // What the server sends: it has no cart at all, so no badge and no lines.
    const serverHtml = renderToString(<CartDrawer />);
    expect(serverHtml).not.toContain(CAT_TOY.title);

    // The shopper's browser, however, is holding a cart from a previous visit.
    addToCart(CAT_TOY, 2);

    container.innerHTML = serverHtml;
    const recovered: unknown[] = [];

    act(() => {
      const root = hydrateRoot(container, <CartDrawer />, {
        onRecoverableError: (error) => recovered.push(error),
      });
      unmount = () => root.unmount();
    });

    // The hydrating render has to reproduce the server's empty cart, or React
    // throws the server's DOM away and rebuilds it. Passing `getCart` as the
    // server snapshot is precisely how that happens: `window` and the stored
    // cart both exist on this second call.
    expect(recovered).toEqual([]);

    // …and the stored cart still arrives, on the render right after.
    const badge = container.querySelector(
      '[data-umami-event="nav-cart-open"] span',
    );
    expect(badge?.textContent).toBe('۲');
    expect(container.textContent).toContain(CAT_TOY.title);
  });
});
