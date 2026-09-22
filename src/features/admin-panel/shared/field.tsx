import { AlertCircle } from 'lucide-react';

/**
 * A labelled control with one message slot under it — the admin forms' field
 * shell. Here rather than at the bottom of `product-form.tsx`, which declared
 * it: it is a presentational piece with no product in it, and this is where
 * the feature folders keep those. Its only caller today is that form; the
 * `Field`/`FieldMessage`/`FieldShell` variants in the discounts, categories
 * and account features are candidates, not consumers — each takes a different
 * set of props and none was changed to reach this one.
 *
 * It renders the label and lets the caller supply the control, so an input, a
 * select and a textarea all wear the same label and the same message without
 * this file knowing which is which. `id` is the caller's — `htmlFor` has to
 * reach the control, not something this component made up.
 */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      <HintOrError hint={hint} error={error} />
    </div>
  );
}

/** One slot under a control: its error if it has one, otherwise its hint. */
export function HintOrError({
  id,
  hint,
  error,
}: {
  id?: string;
  hint?: React.ReactNode;
  error?: string;
}) {
  if (error) {
    return (
      <p
        id={id}
        className="text-destructive mt-1.5 flex items-center gap-1 text-xs"
      >
        <AlertCircle size={12} aria-hidden="true" /> {error}
      </p>
    );
  }
  if (!hint) return null;
  return (
    <p id={id} className="text-muted-foreground mt-1.5 text-xs">
      {hint}
    </p>
  );
}
