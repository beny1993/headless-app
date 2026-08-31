'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { addToCart, type CartLineInput } from '@/features/storefront/cart/cart';
import { cn } from '@/lib/utils';

/**
 * The quick-add button on a product card — the only interactive part of the
 * card, so the only part that ships to the browser.
 *
 * `line` is the display snapshot the cart stores (title, sku, unit price at
 * the moment of adding); see the header of `cart.ts` for why that is display
 * data and never the money that gets charged.
 */
export function AddToCartButton({
  line,
  outOfStock = false,
  className,
}: {
  line: CartLineInput;
  outOfStock?: boolean;
  className?: string;
}) {
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The confirmation is a timer, so it has to be cancelled if the card leaves
  // — a filtered shop grid unmounts these constantly.
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);

  if (outOfStock) {
    return (
      <span
        className={cn(
          'bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full',
          className,
        )}
        // Not a <button disabled>: there is nothing to press and nothing to
        // wait for, so it is a status, not a dead control in the tab order.
        role="img"
        aria-label={`${line.title} ناموجود است`}
      >
        <X size={16} aria-hidden="true" />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        addToCart(line);
        setAdded(true);
        clearTimeout(timer.current ?? undefined);
        timer.current = setTimeout(() => setAdded(false), 1500);
      }}
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-full transition-[background-color,transform] duration-200',
        added
          ? 'bg-success scale-110 text-white'
          : 'bg-primary text-primary-foreground hover:bg-accent-strong',
        className,
      )}
      // The label carries the confirmation: the navbar badge is far away from
      // the pressed button, and a screen reader announces the focused
      // element's new name on its own.
      aria-label={
        added
          ? `${line.title} به سبد خرید اضافه شد`
          : `افزودن ${line.title} به سبد خرید`
      }
      data-umami-event="product-card-add-to-cart"
    >
      {added ? (
        <Check size={16} aria-hidden="true" />
      ) : (
        <Plus size={16} aria-hidden="true" />
      )}
    </button>
  );
}
