import { cn } from '@/lib/utils';

/** The heading every page shows the shopper's checkout note under. */
export const CUSTOMER_NOTE_LABEL = 'توضیحات سفارش';

/**
 * The shopper's note as they typed it: line breaks kept (the contract folds
 * runs of blank lines, so a note stays short), and `wrap-anywhere` so one
 * long unbroken word cannot widen a grid or flex cell past a phone screen.
 * Rendered as text — React escapes it, and the contract has already refused
 * the bidi controls that could reorder the page around it.
 */
export function CustomerNoteText({
  note,
  className,
}: {
  note: string;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'text-sm leading-relaxed wrap-anywhere whitespace-pre-line',
        className,
      )}
    >
      {note}
    </p>
  );
}
