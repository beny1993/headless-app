'use client';

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

/**
 * The wiring for a native modal `<dialog>` — the house pattern for every
 * overlay on the storefront (mobile menu, cart drawer, shop filter sheet). The
 * platform gives the focus trap, Escape, background inertness, top-layer
 * stacking and nothing focusable while closed, with no overlay dependency; this
 * hook adds the `open` mirror that drives the trigger's aria-expanded, and keeps
 * it in step with every way the dialog closes.
 *
 * Closing goes through `close()`, never through `dialogRef.current.close()`
 * directly: the DOM call and the `open` mirror have to move together. Relying on
 * the dialog's `close` event to do the second half looks right but is not
 * dependable — measured not to fire at all in Chromium here, leaving the toggle
 * stuck at aria-expanded="true".
 *
 * Spread `dialogProps` on the `<dialog>`. Its backdrop click is a click whose
 * target is the dialog itself — only true when the panel inside fills the
 * dialog (`h-full`, or content that covers it): otherwise the dialog element
 * shows through under short content and a tap on the panel's own empty space
 * dismisses it.
 *
 * The scroll lock is `body:has(dialog[open])` in globals.css.
 */
export function useModalDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    dialogRef.current?.close();
    setOpen(false);
  }, []);

  // Both halves, for the same reason as `close`. Stable identity, so a caller
  // may subscribe with it once. `showModal()` on an already-open dialog throws
  // InvalidStateError, which is reachable: adding to the cart while the drawer
  // is open.
  const show = useCallback(() => {
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    setOpen(true);
  }, []);

  const dialogProps = {
    ref: dialogRef,
    // Escape is the one close the UA performs on its own. Focus is trapped
    // inside the dialog while it is open, so the keydown always lands here.
    onKeyDown: (event: KeyboardEvent<HTMLDialogElement>) => {
      if (event.key === 'Escape') close();
    },
    // Kept as a backstop for any other UA-initiated close; a no-op where the
    // event does not fire, correct where it does.
    onClose: () => setOpen(false),
    onClick: (event: MouseEvent<HTMLDialogElement>) => {
      if (event.target === dialogRef.current) close();
    },
  };

  return { open, show, close, dialogProps };
}
