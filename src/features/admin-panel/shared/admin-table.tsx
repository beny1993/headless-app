import type { ReactNode } from 'react';

const TH = 'text-muted-foreground px-4 py-3 text-start font-semibold';

/**
 * The admin panel's table shell: the bordered card, the horizontal scroll that
 * keeps a wide table from pushing the page off-screen, and the header row.
 * `actions` names a trailing controls column for screen readers only.
 */
export function AdminTable({
  headings,
  actions,
  children,
}: {
  headings: string[];
  actions?: string;
  children: ReactNode;
}) {
  return (
    <div className="border-border overflow-hidden rounded-2xl border bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr>
              {headings.map((heading) => (
                <th key={heading} className={TH}>
                  {heading}
                </th>
              ))}
              {actions && (
                <th className={TH}>
                  <span className="sr-only">{actions}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}
