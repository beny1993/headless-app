'use client';

// The one field kit, storefront and admin alike: a label, the control, and one
// message slot under it — the destructive-border + tinted-fill +
// `aria-invalid`/`aria-describedby` treatment ported from the design's `Field`.
// `FieldShell` wraps any control (select, textarea, a button group) and leaves
// the control, and its `data-umami-event`, to the caller; `TextField` is the
// text-input convenience. A message's id is derived from the control's:
// `${id}-error` or `${id}-hint`, which is what `fieldAria` points at.
import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The shared control classes; `invalid` swaps the border/fill to destructive.
 * Padding sets the height, so a textarea grows with its rows; a one-off size
 * (a table cell's narrow input) overrides through `cn`.
 */
export const controlClass = (invalid: boolean) =>
  cn(
    'bg-secondary focus-visible:border-accent-strong w-full rounded-xl border px-4 py-3 text-start transition-colors outline-none focus-visible:ring-2',
    invalid ? 'border-destructive bg-destructive-soft/40' : 'border-border',
  );

/** The table-row size of a control: `h-10`, padding no longer setting it. */
export const COMPACT_CONTROL = 'h-10 py-0';

/** What a control inside `FieldShell` sets so its message is announced. */
export const fieldAria = (id: string, error?: string, hint?: ReactNode) => ({
  'aria-invalid': Boolean(error),
  'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
});

/** One slot under a control: its error if it has one, otherwise its hint. */
export function FieldMessage({
  id,
  error,
  hint,
}: {
  id: string;
  error?: string;
  hint?: ReactNode;
}) {
  if (error) {
    return (
      <p
        id={`${id}-error`}
        className="text-destructive mt-1.5 flex items-center gap-1 text-xs"
      >
        <AlertCircle size={12} className="shrink-0" aria-hidden="true" />{' '}
        {error}
      </p>
    );
  }
  if (!hint) return null;
  return (
    <p id={`${id}-hint`} className="text-muted-foreground mt-1.5 text-xs">
      {hint}
    </p>
  );
}

export function FieldShell({
  id,
  label,
  error,
  hint,
  hideLabel,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  /** Keep the label for screen readers only — a table cell's inline edit. */
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={hideLabel ? 'sr-only' : 'mb-1.5 block text-sm font-medium'}
      >
        {label}
      </label>
      {children}
      <FieldMessage id={id} error={error} hint={hint} />
    </div>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  dir,
  inputMode,
  placeholder,
  hideLabel,
  compact,
  umami,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  dir?: 'ltr' | 'rtl';
  inputMode?: 'text' | 'tel' | 'numeric' | 'url';
  placeholder?: string;
  hideLabel?: boolean;
  /** The table-row size: a shorter control with a minimum width. */
  compact?: boolean;
  umami: string;
}) {
  return (
    <FieldShell
      id={id}
      label={label}
      error={error}
      hint={hint}
      hideLabel={hideLabel}
      className={compact ? 'min-w-32' : undefined}
    >
      <input
        id={id}
        type="text"
        dir={dir}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        {...fieldAria(id, error, hint)}
        className={cn(controlClass(Boolean(error)), compact && COMPACT_CONTROL)}
        data-umami-event={umami}
      />
    </FieldShell>
  );
}
