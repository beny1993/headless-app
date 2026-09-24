'use client';

// The pieces the account tabs share: the empty-list card, and the add / edit /
// delete shell the pets and addresses tabs are both built from.
import { useState, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { reasonFrom } from '@/lib/checkout/field-errors';
import { cn } from '@/lib/utils';

export const GENERIC_ERROR = 'انجام نشد. لطفاً دوباره تلاش کن.';

/** The «nothing here yet» card of an account list. */
export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-secondary/40 rounded-2xl py-16 text-center">
      {icon}
      <p className="mb-1 font-semibold">{title}</p>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}

/**
 * The inline «… حذف شود؟» strip under a list item. `onConfirm` does the delete
 * and throws on failure; the refusal is shown here and the buttons come back.
 */
export function DeleteConfirm({
  question,
  umami,
  className,
  onCancel,
  onConfirm,
}: {
  question: string;
  /** The confirm button's `data-umami-event` — the e2e selector. */
  umami: string;
  className?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  return (
    <div className={cn('bg-destructive-soft/40 rounded-lg p-3', className)}>
      <p className="mb-2 text-sm font-medium">{question}</p>
      {error && (
        <p role="alert" className="text-destructive mb-2 text-xs">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(undefined);
            try {
              await onConfirm();
            } catch (caught) {
              setError(reasonFrom(caught) ?? GENERIC_ERROR);
              setBusy(false);
            }
          }}
          className="bg-destructive rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-60"
          data-umami-event={umami}
        >
          {busy ? 'در حال حذف…' : 'حذف'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="border-border hover:bg-secondary rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
        >
          انصراف
        </button>
      </div>
    </div>
  );
}

/** A form's whole-request error, above its fields. Renders nothing without one. */
export function FormAlert({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="text-destructive border-destructive/30 bg-destructive-soft/40 mb-4 flex items-center gap-2 rounded-xl border p-3 text-sm"
    >
      <AlertCircle size={16} className="shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

/** The «ذخیره» / «انصراف» footer; both disable while a save is in flight. */
export function FormActions({
  busy,
  onSave,
  onCancel,
  saveUmami,
  cancelUmami,
  saveIcon,
}: {
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
  saveUmami: string;
  cancelUmami: string;
  saveIcon?: ReactNode;
}) {
  return (
    <div className="mt-5 flex gap-3">
      <button
        type="button"
        onClick={onSave}
        disabled={busy}
        className="bg-brand hover:bg-brand-hover text-brand-foreground flex-1 rounded-xl py-3 font-bold transition-colors disabled:opacity-60"
        data-umami-event={saveUmami}
      >
        <span className="flex items-center justify-center gap-2">
          {saveIcon}
          {busy ? 'در حال ذخیره…' : 'ذخیره'}
        </span>
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="border-border hover:bg-secondary rounded-xl border-2 px-5 py-3 font-medium transition-colors disabled:opacity-60"
        data-umami-event={cancelUmami}
      >
        انصراف
      </button>
    </div>
  );
}

/**
 * An edit form's state: the values, their field errors, the whole-request error
 * and the in-flight flag. `set` writes one field and clears that field's error.
 */
export function useFormState<V extends object>(initial: V) {
  const [form, setForm] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof V>(key: K, value: V[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key as string];
      return next;
    });
  };

  return {
    form,
    set,
    fieldErrors,
    setFieldErrors,
    topError,
    setTopError,
    busy,
    setBusy,
  };
}
