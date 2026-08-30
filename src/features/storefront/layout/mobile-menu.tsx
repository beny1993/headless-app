'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { NAV_LINKS } from './nav-links';
import { PATHS } from '@/lib/constant/paths';

/**
 * Mobile navigation panel, opening from the start edge (the right, in RTL) the
 * way the prototype's Sheet does.
 *
 * Built on a native modal `<dialog>` rather than a Radix/shadcn Sheet: the
 * platform already gives the focus trap, Escape-to-close, background inertness
 * and top-layer stacking that the design review asked for, with no dependency
 * and no vendored primitive. The one thing it does not give is a scroll lock —
 * `body:has(dialog[open])` in globals.css covers that.
 */
export function MobileMenu() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  // Closing goes through here, never through `dialogRef.current.close()`
  // directly: the DOM call and the `open` mirror that drives aria-expanded have
  // to move together. Relying on the dialog's `close` event to do the second
  // half looks right but is not dependable — measured not to fire at all in
  // Chromium here, leaving the toggle stuck at aria-expanded="true".
  const close = () => {
    dialogRef.current?.close();
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          dialogRef.current?.showModal();
          setOpen(true);
        }}
        className="hover:bg-secondary text-foreground flex size-10 items-center justify-center rounded-full transition-colors md:hidden"
        aria-label="باز کردن منو"
        aria-expanded={open}
        data-umami-event="nav-mobile-menu-open"
      >
        <Menu size={18} aria-hidden="true" />
      </button>

      <dialog
        ref={dialogRef}
        // Escape is the one close the UA performs on its own. Focus is trapped
        // inside the dialog while it is open, so the keydown always lands here.
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
        }}
        // Kept as a backstop for any other UA-initiated close; a no-op where
        // the event does not fire, correct where it does.
        onClose={() => setOpen(false)}
        // A click whose target is the dialog itself landed on the backdrop.
        // Only true because the panel below is `h-full`: without it the dialog
        // element shows through under the short content and a tap on the
        // panel's own empty space dismisses the menu.
        onClick={(event) => {
          if (event.target === dialogRef.current) close();
        }}
        // Undo the UA's centered-box defaults and pin the panel to the start
        // edge, full height. Logical `start-0` keeps it correct in both
        // directions; `backdrop:` styles the ::backdrop pseudo-element.
        className="bg-background fixed inset-y-0 start-0 m-0 h-full max-h-none w-72 max-w-none border-0 p-0 shadow-lg backdrop:bg-black/50"
        aria-label="منوی اصلی"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b p-4">
            <p className="text-foreground font-semibold">منو</p>
            <button
              type="button"
              onClick={close}
              className="hover:bg-secondary flex size-10 items-center justify-center rounded-full transition-colors"
              aria-label="بستن منو"
              data-umami-event="nav-mobile-menu-close"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <nav className="flex flex-col gap-1 p-4">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={close}
                className="hover:bg-secondary rounded-xl px-2 py-3.5 text-start text-lg font-semibold transition-colors"
                data-umami-event="nav-mobile-link-click"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href={PATHS.ACCOUNT}
              onClick={close}
              className="hover:bg-secondary border-border mt-2 rounded-xl border-t px-2 py-3.5 pt-4 text-start text-lg font-semibold transition-colors"
              data-umami-event="nav-mobile-account-click"
            >
              حساب کاربری
            </Link>
          </nav>
        </div>
      </dialog>
    </>
  );
}
