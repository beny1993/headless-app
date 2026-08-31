// @vitest-environment node
//
// The cart module is imported by a component that Next renders on the server
// first. Nothing may touch `window` or `localStorage` at import time or on the
// server render path — in a DOM-less environment that is a crash, not a
// degraded cart. The happy-dom suite in cart.test.ts cannot prove this.
import { describe, expect, it } from 'vitest';
import { addLine, cartTotal, getCart, subscribe } from './cart';

describe('the cart without a browser', () => {
  it('imports without a window', () => {
    expect(typeof window).toBe('undefined');
  });

  it('reads as empty', () => {
    expect(getCart()).toEqual([]);
  });

  it('hands back the same empty cart every time, so React can render it', () => {
    expect(getCart()).toBe(getCart());
  });

  it('subscribes to nothing and unsubscribes cleanly', () => {
    const unsubscribe = subscribe(() => {
      throw new Error('a server render must never be notified');
    });

    expect(() => unsubscribe()).not.toThrow();
  });

  it('still computes totals, so a server render can show them', () => {
    const lines = addLine([], {
      productId: 'p1',
      slug: 'cat-toy',
      title: 'اسباب‌بازی گربه',
      sku: 'SKU-1',
      unitPrice: 185_000,
    });

    expect(cartTotal(lines)).toBe(185_000n);
  });
});
