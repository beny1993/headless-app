'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useModalDialog } from '@/hooks/use-modal-dialog';
import { ApiRequestError, delData } from '@/lib/api-client';
import {
  DELETE_INTENTS,
  DELETE_OUTCOMES,
  HARD_DELETE_BLOCKERS,
  productDeleteResultSchema,
  productDeleteSearch,
  type HardDeleteBlocker,
} from '@/lib/catalog/product-delete';
import { apiAdminProductPath } from '@/lib/constant/paths';

/** Why the product can only be hidden, in the modal's own words. */
const BLOCKED_BECAUSE: Record<HardDeleteBlocker, string> = {
  [HARD_DELETE_BLOCKERS.ORDERS]:
    'در سفارش‌ها آمده است و سابقه‌ی آن سفارش‌ها به آن نیاز دارد.',
  [HARD_DELETE_BLOCKERS.MEMBERS]:
    'زیرمجموعه دارد و زیرمجموعه‌هایش به آن وصل‌اند.',
};

/** The toast for a confirmed delete the server turned into a deactivation. */
const deactivatedInstead = (title: string) =>
  `«${title}» در این فاصله سفارش یا زیرمجموعه پیدا کرد؛ حذف نشد و فقط غیرفعال شد.`;

/**
 * The admin list's 🗑. It opens a confirmation that promises what the list
 * knows: a permanent delete when nothing references the product (`blocker`
 * null), otherwise a deactivation and the reason. The request carries that
 * intent, and the server never does more: a confirmed deactivation stays one.
 * A confirmed delete is decided again under the product's row lock, and when
 * an order landed in between it comes back as a deactivation, which a warning
 * toast then says. A failure is an error toast.
 */
export function DeleteProductButton({
  id,
  title,
  blocker,
}: {
  id: string;
  title: string;
  blocker: HardDeleteBlocker | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { open, show, close, dialogProps } = useModalDialog();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const descriptionId = useId();
  const intent =
    blocker === null ? DELETE_INTENTS.DELETE : DELETE_INTENTS.DEACTIVATE;

  // While the request runs, an Escape keydown is prevented on `window`: a
  // prevented keydown stops the browser's close request on every press,
  // whereas a `cancel` can be refused only once per user activation. On
  // `window` because both buttons are disabled meanwhile, so focus may have
  // left the dialog for <body>, where its own keydown handler never runs.
  useEffect(() => {
    if (!busy) return;
    const holdEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') event.preventDefault();
    };
    window.addEventListener('keydown', holdEscape);
    return () => window.removeEventListener('keydown', holdEscape);
  }, [busy]);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = productDeleteResultSchema.safeParse(
        await delData(
          `${apiAdminProductPath(id)}${productDeleteSearch({ confirm: intent })}`,
        ),
      );
      close();
      // A 2xx that is not the promised shape still did something; the refresh
      // below shows what, so only a readable outcome earns a toast.
      if (
        intent === DELETE_INTENTS.DELETE &&
        result.success &&
        result.data.outcome === DELETE_OUTCOMES.DEACTIVATED
      ) {
        toast.warning(deactivatedInstead(title));
      }
      router.refresh();
      // Ready again: a row that stays listed may keep this button.
      setBusy(false);
    } catch (error) {
      setBusy(false);
      close();
      // Back to the button that opened the dialog, not <body>. It is never
      // `disabled` (see below), so it can always take the focus.
      triggerRef.current?.focus();
      // Only the server's own sentence — `ApiRequestError` carries the envelope
      // `message`, which for a family head names how many members are in the
      // way and is already Persian. Every other rejection is a transport
      // failure whose message is an internal English string, and there
      // «try again» is exactly the right advice.
      toast.error(
        error instanceof ApiRequestError && error.message
          ? error.message
          : 'حذف محصول ناموفق بود. دوباره تلاش کن.',
      );
    }
  };

  return (
    <>
      {/* Guarded by `busy` rather than `disabled`: a disabled button cannot
          take focus, and focus has to come back here when a request fails. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!busy) show();
        }}
        aria-disabled={busy}
        aria-label={`حذف ${title}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-umami-event="admin-panel-products-delete"
        className="text-destructive hover:bg-destructive-soft flex h-10 w-10 items-center justify-center rounded-lg transition-colors aria-disabled:opacity-50"
      >
        {busy ? (
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 size={14} aria-hidden="true" />
        )}
      </button>

      <dialog
        {...dialogProps}
        // Not dismissible while the request runs: closing then hid a delete
        // that still landed. The hook's Escape and backdrop handlers are
        // skipped; the browser's own Escape is stopped by the `window`
        // listener above, with `onCancel` as a backstop.
        onKeyDown={(event) => {
          if (!busy) dialogProps.onKeyDown(event);
        }}
        onClick={(event) => {
          if (!busy) dialogProps.onClick(event);
        }}
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
        role="alertdialog"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        // No padding of its own: the card below fills the dialog, so the
        // hook's backdrop click (a click whose target is the dialog itself)
        // lands only outside the card. `m-auto` puts back the UA's centring,
        // which the preflight's margin reset takes away.
        className="bg-background m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border-0 p-0 shadow-lg backdrop:bg-black/50"
      >
        <div className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-2 text-center sm:text-start">
            <h2 id={headingId} className="text-lg font-semibold">
              {blocker === null
                ? `حذف «${title}»؟`
                : `«${title}» حذف‌شدنی نیست`}
            </h2>
            <p id={descriptionId} className="text-muted-foreground text-sm">
              {blocker === null
                ? 'این کار برگشت‌پذیر نیست.'
                : `این محصول ${BLOCKED_BECAUSE[blocker]} می‌توانی غیرفعالش کنی تا از فروشگاه پنهان شود.`}
            </p>
          </div>
          {/* Cancel first in the DOM: a modal dialog focuses its first
              focusable element, so Enter on open never confirms a delete.
              Stacked, the confirm sits on top, as in the prototype. */}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={close}
              disabled={busy}
              data-umami-event="admin-panel-products-delete-cancel"
              className="border-border hover:bg-secondary min-h-11 rounded-xl border-2 px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
            >
              انصراف
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              aria-busy={busy}
              data-umami-event={
                intent === DELETE_INTENTS.DELETE
                  ? 'admin-panel-products-delete-confirm'
                  : 'admin-panel-products-deactivate-confirm'
              }
              className="bg-destructive inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white transition-opacity disabled:opacity-60"
            >
              {busy && (
                <Loader2
                  size={14}
                  className="animate-spin"
                  aria-hidden="true"
                />
              )}
              {blocker === null ? 'حذف' : 'غیرفعال'}
            </button>
          </div>
          {/* The spinner is decoration; this is what a screen reader hears. */}
          <span role="status" className="sr-only">
            {busy ? 'در حال انجام…' : ''}
          </span>
        </div>
      </dialog>
    </>
  );
}
