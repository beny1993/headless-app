// Pins the hand-over in ./drawer-open.ts with the real drawer and the real add
// button: «افزودن به سبد خرید» pressed after the page's hydration commit, but
// before the drawer's subscribing effect has run, must still open the drawer.
//
// That window is real. The button is live from the commit, while React runs a
// hydration's passive effects, `CartDrawer`'s subscription among them, a
// scheduler task later. A shopper who taps add as the product page finishes
// loading lands in it: the line was saved and the badge showed it, but the
// drawer stayed shut (2 of 20 adds pressed on the product page as it loaded,
// at 1280px, and six E2E specs through `openCheckout` in one run). No ordinary
// Playwright step lands in a window one task wide, so the E2E suite meets it
// only by chance; this test lands in it on every run.
//
// `PressAddOnCommit` presses the button from a layout effect, which is inside
// that window on every run. The `showModal` stub is the witness: the log must
// read the press first and the drawer opening after it. Opening during the
// press would mean the drawer was already listening and the test proved
// nothing; never opening is the bug. Stubbing it, as
// src/hooks/use-modal-dialog.test.tsx does, also keeps the test off
// happy-dom's partial `<dialog>`; the outcome is read off the navbar button's
// aria-expanded.
import {
  Fragment,
  StrictMode,
  act,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CartDrawer } from './cart-drawer';
import { clearCart, type CartLineInput } from './cart';
import { ProductPurchase } from '@/features/storefront/product/product-purchase';

// `hydrateRoot` inside `act()` needs this, as in ./cart-drawer.test.tsx.
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

let log: string[];
let container: HTMLDivElement;
let unmount: () => void = () => undefined;

beforeEach(() => {
  log = [];
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(
    function (this: HTMLDialogElement) {
      log.push('drawer opened');
      this.setAttribute('open', '');
    },
  );
  clearCart();
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  act(() => unmount());
  unmount = () => undefined;
  container.remove();
  clearCart();
  vi.restoreAllMocks();
});

/**
 * Presses add from a layout effect: after the commit that made the button
 * live, before any passive effect has run. Last in tree order, so every other
 * layout effect has run first. Once only, because StrictMode runs layout
 * effects twice.
 */
function PressAddOnCommit() {
  const pressed = useRef(false);
  useLayoutEffect(() => {
    if (pressed.current) return;
    pressed.current = true;
    container
      .querySelector<HTMLButtonElement>(
        '[data-umami-event="product-add-to-cart"]',
      )!
      .click();
    // After the click returns, so a drawer that opened during the press, one
    // that was already listening, logs ahead of it.
    log.push('add pressed');
  }, []);
  return null;
}

function ProductPage() {
  return (
    <>
      <CartDrawer />
      <ProductPurchase line={CAT_TOY} stock={5} />
      <PressAddOnCommit />
    </>
  );
}

const navCart = () =>
  container.querySelector('[data-umami-event="nav-cart-open"]');

describe('the cart drawer, opened before it subscribed', () => {
  // StrictMode as well, which `next dev` (and so the E2E suite) runs and
  // production does not: it subscribes the drawer, drops it and subscribes it
  // again, and the drawer still opens. That the open is handed over only once
  // is ./drawer-open.test.ts's pin, since `show()`'s own guard would absorb a
  // second call here.
  it.each<[string, (props: { children: ReactNode }) => ReactNode]>([
    ['', Fragment],
    [' in StrictMode', StrictMode],
  ])('opens for an add pressed before its subscription%s', (_mode, Mode) => {
    container.innerHTML = renderToString(<ProductPage />);
    const recovered: unknown[] = [];

    act(() => {
      const root = hydrateRoot(
        container,
        <Mode>
          <ProductPage />
        </Mode>,
        { onRecoverableError: (error) => recovered.push(error) },
      );
      unmount = () => root.unmount();
    });

    expect(recovered).toEqual([]);
    // Pressed while no drawer listened, opened once one subscribed.
    expect(log).toEqual(['add pressed', 'drawer opened']);
    expect(navCart()?.getAttribute('aria-expanded')).toBe('true');
    // And the add itself landed: one line, on the badge.
    expect(navCart()?.querySelector('span')?.textContent).toBe('۱');
  });
});
