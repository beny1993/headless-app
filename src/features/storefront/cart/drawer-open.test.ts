// @vitest-environment node
//
// Deliberately the node environment: this module is imported by the product
// page's purchase controls, which Next renders on the server first. It must
// hold no DOM assumption at all — a `window` reference here would crash the
// server render rather than degrade.
import { describe, expect, it, vi } from 'vitest';
import { openCartDrawer, subscribeToCartDrawer } from './drawer-open';

describe('the cart drawer open signal', () => {
  it('imports and runs without a window', () => {
    expect(typeof window).toBe('undefined');
    expect(() => openCartDrawer()).not.toThrow();
  });

  it('calls the subscribed drawer', () => {
    const open = vi.fn();
    const unsubscribe = subscribeToCartDrawer(open);

    openCartDrawer();

    expect(open).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('stops calling a drawer that unsubscribed', () => {
    const open = vi.fn();

    subscribeToCartDrawer(open)();
    openCartDrawer();

    expect(open).not.toHaveBeenCalled();
  });

  // React 19 in StrictMode mounts, unmounts and remounts an effect, so the
  // same drawer subscribes twice in development. Each subscription has to be
  // independently removable or the second unmount silently kills a live one.
  it('keeps the other subscriber when one of two unsubscribes', () => {
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = subscribeToCartDrawer(first);
    const unsubscribeSecond = subscribeToCartDrawer(second);
    unsubscribeFirst();
    openCartDrawer();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unsubscribeSecond();
  });

  // The point of a listener set rather than a single slot: nothing here caps
  // the number of mounted drawers, so every live one has to be told. Without
  // this, notifying only the first subscriber passes every other test in the
  // file.
  it('notifies every live subscriber', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeToCartDrawer(first);
    const unsubscribeSecond = subscribeToCartDrawer(second);

    openCartDrawer();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    unsubscribeFirst();
    unsubscribeSecond();
  });

  // One call notifies the drawers subscribed when it started, and no others.
  // A `Set` iterated live would hand a listener added mid-notify to the same
  // pass — a drawer that resubscribes while opening would then open twice.
  it('does not notify a listener subscribed during the same open', () => {
    const late = vi.fn();
    let unsubscribeLate = () => {};
    const resubscribing = vi.fn(() => {
      unsubscribeLate = subscribeToCartDrawer(late);
    });
    const unsubscribe = subscribeToCartDrawer(resubscribing);

    openCartDrawer();

    expect(resubscribing).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();

    // It is subscribed, just not for the pass that added it: the next open
    // reaches it.
    unsubscribe();
    openCartDrawer();
    expect(late).toHaveBeenCalledTimes(1);
    unsubscribeLate();
  });

  // The page renders its add button whether or not a drawer is mounted; a
  // shopper pressing it must never meet an exception because of that.
  it('is a no-op when no drawer is listening', () => {
    expect(() => openCartDrawer()).not.toThrow();
  });

  it('unsubscribes twice without disturbing anything', () => {
    const open = vi.fn();
    const unsubscribe = subscribeToCartDrawer(open);

    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();

    openCartDrawer();
    expect(open).not.toHaveBeenCalled();
  });
});
