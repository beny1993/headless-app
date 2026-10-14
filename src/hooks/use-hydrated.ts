'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether React has hydrated the calling component: false on the server and in
 * the hydrating render, true from the render right after, and true from the
 * first render of anything mounted later (a client-side navigation, a step
 * that opens).
 *
 * For a server-rendered control a tap must not be lost on: render it
 * `disabled={!hydrated}`. Its HTML is on screen before React listens to it, and
 * in that window a tap goes nowhere. React 19 does try to hydrate on the spot
 * when a click, change or input lands on a part it has not hydrated, but drops
 * the event when it cannot finish (a client chunk or a suspended boundary still
 * pending), and never replays it. A `<select>` keeps the option picked in that
 * window on screen only until the next render writes its controlled value back
 * over it. In development the window outlasted the page's `load` event in the
 * E2E suite's traces, and the suite, which acts the moment a control is
 * visible, lost picks and taps to it.
 * Disabled, the browser ignores the tap, and Playwright waits for the control
 * to be enabled before it acts.
 *
 * `useSyncExternalStore` with a server snapshot is React's way to render one
 * value on the server and another on the client without a mismatch: the
 * hydrating render reproduces the server's `false`, and the render after it
 * reads `true`. That is the same render in which every store read this way
 * switches to its client snapshot, which the checkout form relies on: its cart
 * arrives in the render that flips this.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

// Nothing changes after hydration, so there is nothing to listen to. All three
// at module scope: a fresh `subscribe` per render would resubscribe each time.
const subscribe = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;
