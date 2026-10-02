'use client';

import { useRef, type ReactNode } from 'react';
import { AlertCircle, ImageUp } from 'lucide-react';
import { RECEIPT_FORMAT_HINT, validateReceiptFile } from '@/lib/orders/receipt';
import { ACCEPTED_IMAGE_TYPES } from '@/lib/storage/image-upload';
import { cn } from '@/lib/utils';

/**
 * A payment receipt's file picker, for the checkout's payment step and the
 * order pages' receipt box. Controlled: the parent holds the picked file and
 * the refusal, and `onPick` reports each pick once its bytes are checked.
 *
 * The picked file's NAME is never rendered: a phone names a screenshot with its
 * timestamp, and a shopper's page carries no ASCII digit — nor anybody's files.
 *
 * The «picked» live region and the alert are on the page from the start, only
 * their words changing: a live region that arrives together with its text may
 * never be announced. `controls={false}` keeps the alert alone, so the box's
 * refusal stays where it was announced when a 409 re-renders the box with no
 * picker to offer.
 */
export function ReceiptPicker({
  id,
  event,
  file,
  error,
  disabled = false,
  controls = true,
  onPick,
  children,
}: {
  /** The input's id; the hint is `${id}-hint`, the alert `${id}-error`. */
  id: string;
  /** `data-umami-event`, on the input: the label wrapping it forwards the tap. */
  event: string;
  file: File | null;
  error: string | null;
  disabled?: boolean;
  controls?: boolean;
  onPick: (pick: { file: File | null; error: string | null }) => void;
  /** Placed after the picker, before the «picked» line — the box's upload button. */
  children?: ReactNode;
}) {
  // Which pick is the latest: a verdict that arrives after a later pick's is
  // dropped, so the parent always holds the file the shopper picked last.
  const latest = useRef(0);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <>
      {controls && (
        <div className="flex flex-wrap items-center gap-3">
          {/* `has-[:focus-visible]`: the input is `sr-only`, so the focus
              outline goes on the label that stands in for it. */}
          <label
            htmlFor={id}
            className="border-border hover:bg-secondary has-[:focus-visible]:outline-ring inline-flex cursor-pointer items-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-colors has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2"
          >
            <ImageUp size={14} aria-hidden="true" />
            انتخاب تصویر رسید
            <input
              id={id}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              className="sr-only"
              disabled={disabled}
              aria-describedby={error ? `${errorId} ${hintId}` : hintId}
              aria-invalid={error ? true : undefined}
              data-umami-event={event}
              onChange={(change) => {
                const picked = change.target.files?.[0];
                // Emptied, so the same file can be picked again after a refusal.
                change.target.value = '';
                const pick = ++latest.current;
                if (!picked) {
                  onPick({ file: null, error: null });
                  return;
                }
                void validateReceiptFile(picked).then((refusal) => {
                  if (pick !== latest.current) return;
                  onPick({ file: refusal ? null : picked, error: refusal });
                });
              }}
            />
          </label>
          {children}
          <p className="text-sm" aria-live="polite">
            {file ? 'یک تصویر انتخاب شد' : ''}
          </p>
          <p id={hintId} className="text-muted-foreground w-full text-xs">
            {RECEIPT_FORMAT_HINT}
          </p>
        </div>
      )}

      <p
        id={errorId}
        role="alert"
        className={cn(
          'text-destructive flex items-start gap-1.5 text-sm',
          error && 'mt-3',
        )}
      >
        {error && (
          <>
            <AlertCircle
              size={14}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            {error}
          </>
        )}
      </p>
    </>
  );
}
