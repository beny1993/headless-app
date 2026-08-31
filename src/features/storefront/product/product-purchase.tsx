'use client';

import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { isPurchasable } from './availability';
import { MAX_LINE_QTY, addToCart } from '@/features/storefront/cart/cart';
import { openCartDrawer } from '@/features/storefront/cart/drawer-open';
import type { CartLineInput } from '@/features/storefront/cart/cart';
import { formatNumber } from '@/lib/format';

/**
 * The product page's quantity stepper and add-to-cart button — the only part
 * of the page that has to run in the browser.
 *
 * Not `AddToCartButton`: that one is the card's quick-add, has no quantity and
 * is shaped like a 40px circle. What the two share is the important part, the
 * `CartLineInput` snapshot (title, sku, unit price at the moment of adding);
 * see the header of `cart.ts` for why that is display data and never the money
 * that gets charged.
 *
 * Adding opens the drawer (story AC) through `openCartDrawer`, so the
 * confirmation is the cart itself sliding in with the line on it — no separate
 * "added" flourish to fall out of sync with it.
 *
 * The ceiling is the cart module's own `MAX_LINE_QTY`, deliberately not the
 * product's stock. Stock-aware caps were deferred to checkout, where the
 * atomic decrement actually enforces them (`Smokey Shop Info`), and the cart
 * drawer's stepper already behaves this way — a page that capped at stock and
 * a drawer that capped at 99 would disagree about the same line.
 */
export function ProductPurchase({
  line,
  stock,
}: {
  line: CartLineInput;
  stock: number;
}) {
  const [qty, setQty] = useState(1);
  const purchasable = isPurchasable(stock);

  if (!purchasable) {
    return (
      <button
        type="button"
        disabled
        // A real `disabled` button, unlike the steppers below: this state comes
        // from the server render and cannot flip under the shopper's finger, so
        // nothing loses focus. It stays a button rather than becoming text
        // because the design shows the control in place, greyed out.
        className="bg-muted text-muted-foreground w-full cursor-not-allowed rounded-xl py-3.5 font-bold"
        data-umami-event="product-add-to-cart-unavailable"
      >
        ناموجود
      </button>
    );
  }

  const atMax = qty >= MAX_LINE_QTY;
  const atMin = qty <= 1;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="border-border flex items-center rounded-xl border-2">
        {/* `aria-disabled` rather than `disabled`, the drawer's pattern: a
            bound is reached by pressing the very button that then goes dead,
            and a `disabled` attribute on the focused element drops focus to
            <body> — where Tab restarts from the top of the page. Announced the
            same, still focusable, inert through the guard in the handler. */}
        <button
          type="button"
          onClick={() => {
            if (!atMin) setQty(qty - 1);
          }}
          aria-disabled={atMin}
          aria-label="کاهش تعداد"
          className="hover:bg-secondary flex h-12 w-11 items-center justify-center transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
          data-umami-event="product-qty-decrease"
        >
          <Minus size={14} aria-hidden="true" />
        </button>
        <span className="nums w-12 text-center font-medium" aria-live="polite">
          {formatNumber(qty)}
        </span>
        <button
          type="button"
          onClick={() => {
            if (!atMax) setQty(qty + 1);
          }}
          aria-disabled={atMax}
          aria-label="افزایش تعداد"
          className="hover:bg-secondary flex h-12 w-11 items-center justify-center transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
          data-umami-event="product-qty-increase"
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => {
          addToCart(line, qty);
          openCartDrawer();
        }}
        className="bg-accent-strong hover:bg-accent-hover min-w-48 flex-1 rounded-xl py-3.5 font-bold text-white transition-colors"
        data-umami-event="product-add-to-cart"
      >
        افزودن به سبد خرید
      </button>

      {atMax && (
        <p className="text-muted-foreground w-full text-xs">
          حداکثر تعداد در هر سفارش
        </p>
      )}
    </div>
  );
}
