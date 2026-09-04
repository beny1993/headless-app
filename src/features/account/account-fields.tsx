'use client';

// The one field pattern the account forms (pet, address) reuse: a label, the
// control, and an inline Persian error — the destructive-border + tinted-fill +
// `aria-invalid`/`aria-describedby` treatment ported from the design's `Field`
// (and matching the checkout form). `FieldShell` wraps a select/textarea/button
// group; `TextField` is the input convenience.
import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The shared control classes; `invalid` swaps the border/fill to destructive. */
export const controlClass = (invalid: boolean) =>
  cn(
    'bg-secondary focus-visible:border-accent-strong w-full rounded-xl border px-4 py-3 text-start transition-colors outline-none focus-visible:ring-2',
    invalid ? 'border-destructive bg-destructive-soft/40' : 'border-border',
  );

export function FieldShell({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p
          id={`${id}-error`}
          className="text-destructive mt-1.5 flex items-center gap-1 text-xs"
        >
          <AlertCircle size={12} className="shrink-0" aria-hidden="true" />{' '}
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground mt-1.5 text-xs">
          {hint}
        </p>
      ) : null}
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
  umami: string;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <input
        id={id}
        type="text"
        dir={dir}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className={controlClass(Boolean(error))}
        data-umami-event={umami}
      />
    </FieldShell>
  );
}
