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

  const close = () => dialogRef.current?.close();

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
        // `open` mirrors the dialog for aria-expanded. The `close` event is the
        // only reliable source: Escape closes the dialog without touching the
        // toggle, so tracking it on click alone would desync.
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialogRef.current) close();
        }}
        // Undo the UA's centered-box defaults and pin the panel to the start
        // edge, full height. Logical `start-0` keeps it correct in both
        // directions; `backdrop:` styles the ::backdrop pseudo-element.
        className="bg-background fixed inset-y-0 start-0 m-0 h-full max-h-none w-72 max-w-none border-0 p-0 shadow-lg backdrop:bg-black/50"
        aria-label="منوی اصلی"
      >
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
      </dialog>
    </>
  );
}
