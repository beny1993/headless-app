'use client';

import { useCallback, useEffect, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { buildShopHref, updateShopQuery, type ShopQuery } from './shop-query';
import { cn } from '@/lib/utils';

/**
 * How long the box waits before turning what was typed into a URL.
 *
 * A navigation per keystroke would be a request per keystroke; a wait long
 * enough to notice would make the shop feel broken. 350ms is about one pause
 * between Persian words.
 */
const DEBOUNCE_MS = 350;

/**
 * The shop's search box.
 *
 * The URL is the state here as much as it is for the filters: what the shopper
 * types becomes `?q=…`, the server component reads it back, and a shared link
 * or the back button reproduces the search exactly. Nothing about which
 * products match is decided in the browser.
 *
 * Two pieces of local state, and the second one is the whole trick. `term` is
 * what is in the box. `urlTerm` is the term this component last put into the
 * URL. A navigation that agrees with `urlTerm` is one of our own and is
 * ignored; a navigation that disagrees — the back button, a shared link, the
 * cleared-search button in the empty state — is somebody else moving, and the
 * box follows it. Without that distinction the input would fight itself: our
 * own debounced push lands a few hundred milliseconds later, and re-syncing
 * blindly would throw away every character typed in the meantime.
 *
 * The term travels raw. Normalization (Arabic ي/ك, digits, ZWNJ) happens in the
 * DAO against a column normalized by the same function — doing it here would
 * rewrite the shopper's own text under their cursor.
 */
export function ShopSearch({ query }: { query: ShopQuery }) {
  const router = useRouter();
  const inputId = useId();
  const [pending, startTransition] = useTransition();

  const urlValue = query.q ?? '';
  const [term, setTerm] = useState(urlValue);
  const [urlTerm, setUrlTerm] = useState(urlValue);

  // Adjusting state during render rather than in an effect, which is React's
  // own answer for "a prop changed and some state derives from it": it settles
  // before the browser paints, so the box never shows the previous search for a
  // frame. The guard is what makes it terminate.
  if (urlValue !== urlTerm) {
    setUrlTerm(urlValue);
    setTerm(urlValue);
  }

  // The URL this box is heading for, built during render because it is a pure
  // function of what is on screen. It is also a plain string, which is what
  // lets the effect below name every one of its dependencies honestly: the
  // query object is rebuilt on every render and would restart the debounce on
  // renders that had nothing to do with typing.
  //
  // An empty box is no search rather than a search for nothing —
  // `updateShopQuery` drops the parameter and the URL is the plain listing again.
  const nextHref = buildShopHref(
    updateShopQuery(query, { q: term || undefined }),
  );

  const go = useCallback(() => {
    setUrlTerm(term);
    startTransition(() => router.push(nextHref));
  }, [term, nextHref, router]);

  useEffect(() => {
    if (term === urlTerm) return;
    const timer = setTimeout(go, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, urlTerm, go]);

  return (
    <form
      className="mb-5 max-w-xl"
      onSubmit={(event) => {
        // Enter should not wait out the debounce — a shopper who pressed it has
        // already decided.
        event.preventDefault();
        go();
      }}
      role="search"
    >
      <label htmlFor={inputId} className="sr-only">
        جستجو در محصولات
      </label>
      <div className="relative">
        <Search
          size={16}
          className="text-muted-foreground pointer-events-none absolute start-4 top-1/2 -translate-y-1/2"
          aria-hidden="true"
        />
        <input
          id={inputId}
          type="search"
          name="q"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="جستجو بین محصولات…"
          // `type="search"` brings the browser's own clear button, and clearing
          // it fires `change` like any other edit — so the box empties, the
          // debounce runs, and the URL loses its `q`.
          autoComplete="off"
          aria-busy={pending}
          className={cn(
            'bg-secondary border-border focus-visible:border-accent-strong w-full rounded-xl border py-3 ps-11 pe-4 transition-colors',
            pending && 'opacity-70',
          )}
          data-umami-event="shop-search-type"
        />
      </div>
    </form>
  );
}
