'use client';

// The pieces the account tabs share: the empty-list card, and the add / edit /
// delete shell the pets and addresses tabs are both built from.
import type { ReactNode } from 'react';

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
