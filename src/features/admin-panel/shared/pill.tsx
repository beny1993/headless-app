import type { ReactNode } from 'react';

const TONES = {
  success: 'bg-success-soft text-success-strong',
  muted: 'bg-secondary text-muted-foreground',
} as const;

/** A status pill: active/inactive, paid/unpaid. */
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
