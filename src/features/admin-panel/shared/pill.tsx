import type { ReactNode } from 'react';

const TONES = {
  success: 'bg-success-soft text-success-strong',
  muted: 'bg-secondary text-muted-foreground',
  // The theme's badge-text pair, for a label that is not a good/bad state.
  accent: 'bg-accent-soft text-accent-hover',
} as const;

/** A status or role pill: active/inactive, paid/unpaid, admin/customer. */
export function Pill({
  tone,
  children,
}: {
  tone: keyof typeof TONES;
  children: ReactNode;
}) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
