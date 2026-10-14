// @vitest-environment node
//
// Deliberately the node environment: this module is imported by the product
// page's purchase controls, which Next renders on the server first. It must
// hold no DOM assumption at all — a `window` reference here would crash the
// server render rather than degrade.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Signal = typeof import('./drawer-open');
let openCartDrawer: Signal['openCartDrawer'];
let subscribeToCartDrawer: Signal['subscribeToCartDrawer'];
let UNHEARD_OPEN_MS: Signal['UNHEARD_OPEN_MS'];

// A fresh copy of the module for every test, the way each page load gets one.
// The module holds state now (an open no drawer heard), and a test that fails
// before unsubscribing would leave a listener behind that silently changes
// what every later test sees.
beforeEach(async () => {
  vi.resetModules();
  ({ openCartDrawer, subscribeToCartDrawer, UNHEARD_OPEN_MS } =
    await import('./drawer-open'));
});

afterEach(() => {
  vi.useRealTimers();
});

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
  it('never throws when no drawer is listening', () => {
    expect(() => openCartDrawer()).not.toThrow();
  });

  // The tap that lands as the product page finishes hydrating: the add button
  // is live from the commit, while the drawer subscribes in an effect React
  // runs a task later. Without this the line is saved and the drawer stays
  // shut.
  it('hands an open no drawer heard to the first drawer that subscribes, once', () => {
    openCartDrawer();

    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeToCartDrawer(first);
    const unsubscribeSecond = subscribeToCartDrawer(second);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    // From then on an open reaches every drawer, as before.
    openCartDrawer();
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
    unsubscribeFirst();
    unsubscribeSecond();
  });

  // StrictMode subscribes the same drawer, unsubscribes it and subscribes it
  // again. The open it was handed must not come round a second time.
  it('does not hand it over again when StrictMode resubscribes the drawer', () => {
    openCartDrawer();
    const open = vi.fn();

    subscribeToCartDrawer(open)();
    const unsubscribe = subscribeToCartDrawer(open);

    expect(open).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  // Only an open that found nobody is kept; one a drawer heard is spent.
  it('keeps nothing of an open a drawer heard', () => {
    const heard = vi.fn();
    const unsubscribeHeard = subscribeToCartDrawer(heard);
    openCartDrawer();

    const later = vi.fn();
    const unsubscribeLater = subscribeToCartDrawer(later);

    expect(heard).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
    unsubscribeHeard();
    unsubscribeLater();
  });

  // The bound. Every page with the add button has the navbar today; a page
  // that one day does not must not leave an open behind for the drawer of
  // whatever page the shopper reaches next.
  describe('an open no drawer heard, kept for UNHEARD_OPEN_MS', () => {
    const pressedAt = new Date('2026-10-12T12:00:00Z').getTime();
    const subscribeAfter = (waited: number) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(pressedAt);
      openCartDrawer();
      vi.setSystemTime(pressedAt + waited);
      const open = vi.fn();
      return { open, unsubscribe: subscribeToCartDrawer(open) };
    };

    it('is still handed over at the bound', () => {
      const { open, unsubscribe } = subscribeAfter(UNHEARD_OPEN_MS);

      expect(open).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it('is dropped past it, for good, and the next open still arrives', () => {
      const { open, unsubscribe } = subscribeAfter(UNHEARD_OPEN_MS + 1);
      expect(open).not.toHaveBeenCalled();

      // Dropped by the drawer that found it stale, not left for another one.
      unsubscribe();
      const next = vi.fn();
      const unsubscribeNext = subscribeToCartDrawer(next);
      expect(next).not.toHaveBeenCalled();

      openCartDrawer();
      expect(next).toHaveBeenCalledTimes(1);
      unsubscribeNext();
    });
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
