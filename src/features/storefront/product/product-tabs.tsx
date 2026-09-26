'use client';

import { useId, useState } from 'react';

type ProductTab = {
  id: string;
  label: string;
  /** Rendered by the server component that passes it — see the note below. */
  content: React.ReactNode;
};

/**
 * The product page's description / details tabs.
 *
 * Toggle buttons carrying `aria-pressed` and `aria-controls`, not
 * `role="tab"` — the same call `routine.tsx` documents: the tab role promises
 * arrow-key roving focus, and a half-built widget reads worse to a screen
 * reader than a plain pair of pressed buttons. No dependency either way.
 *
 * The panels arrive as `content` from the server component, so the product's
 * text and specification rows are rendered on the server and this island ships
 * nothing but the index of the visible one.
 *
 * Every panel stays mounted-or-not by index rather than by string id: an
 * unknown id could otherwise leave the page with no panel at all.
 */
export function ProductTabs({ tabs }: { tabs: ProductTab[] }) {
  const [active, setActive] = useState(0);
  const panelId = useId();

  if (tabs.length === 0) return null;
  const current = tabs[active] ?? tabs[0];

  return (
    <div>
      <div className="border-border mb-8 flex gap-1 overflow-x-auto border-b">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(index)}
            aria-pressed={index === active}
            aria-controls={panelId}
            className={`-mb-px border-b-2 px-5 py-3 text-sm font-semibold whitespace-nowrap transition-colors ${
              index === active
                ? 'border-accent-strong text-accent-strong'
                : 'text-muted-foreground hover:text-foreground border-transparent'
            }`}
            data-umami-event="product-tab-select"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div id={panelId} role="region" aria-label={current.label}>
        {current.content}
      </div>
    </div>
  );
}
