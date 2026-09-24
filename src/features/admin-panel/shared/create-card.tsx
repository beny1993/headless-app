import type { ReactNode } from 'react';
import { Check, Loader2, Plus } from 'lucide-react';

/**
 * The admin panel's create-form card: a titled form, its fields in two columns,
 * and a submit button that spins while `busy` and is followed by `done` — the
 * success line — once the last submit went through.
 */
export function CreateCard({
  title,
  icon,
  onSubmit,
  busy,
  done,
  submitLabel,
  submitIcon = <Plus size={14} aria-hidden="true" />,
  umami,
  children,
}: {
  title: string;
  icon?: ReactNode;
  onSubmit: () => Promise<void>;
  busy: boolean;
  done: ReactNode;
  submitLabel: string;
  submitIcon?: ReactNode;
  umami: string;
  children: ReactNode;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
      className="border-border bg-card flex flex-col gap-4 rounded-2xl border p-6"
    >
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="font-bold">{title}</h2>
      </div>

      {/* Two columns, not three: four fields in `sm:grid-cols-3` leave one
          orphan on a half-width row. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          data-umami-event={umami}
          className="bg-accent-strong hover:bg-accent-hover inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            submitIcon
          )}
          {submitLabel}
        </button>
        {done && (
          <span
            role="status"
            className="text-success-strong flex items-center gap-1 text-sm"
          >
            <Check size={16} aria-hidden="true" /> {done}
          </span>
        )}
      </div>
    </form>
  );
}
