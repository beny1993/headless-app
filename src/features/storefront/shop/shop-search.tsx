'use client';

import { useCallback, useEffect, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { buildShopHref, updateShopQuery, type ShopQuery } from './shop-query';
import { MAX_SEARCH_TERM_LENGTH } from '@/lib/catalog/product-query';
import { cn } from '@/lib/utils';
import { controlClass } from '@/components/ui/field';

/** About one pause between Persian words; a push per keystroke is a request per keystroke. */
const DEBOUNCE_MS = 350;

/**
 * The shop's search box. The URL is the state: what is typed becomes `?q=…`
 * and the server component reads it back.
 *
 * Invariant: **re-sync the box only when the URL changes to a value this
 * component did not push.** The back button, a shared link and the empty
 * state's clear-search link must be followed; our own push must not touch the
 * box, or what the shopper typed during the round trip is thrown away.
 *
 * `term` is what is in the box. `seenUrl` tracks the prop alone and answers
 * «did the URL move?»; `pushed` answers «was that us?». Keep them separate:
 * between the debounce and the response the URL and our intention disagree by
 * construction.
 *
 * The term travels raw; normalization (ي/ك, digits, ZWNJ) happens in the DAO,
 * not under the shopper's cursor.
 */
export function ShopSearch({ query }: { query: ShopQuery }) {
  const router = useRouter();
  const inputId = useId();
  const [pending, startTransition] = useTransition();

  const urlValue = query.q ?? '';
  const [term, setTerm] = useState(urlValue);
  /** The last `q` this component has actually rendered against. */
  const [seenUrl, setSeenUrl] = useState(urlValue);
  /** The last term this component asked the router for. */
  const [pushed, setPushed] = useState(urlValue);

  // State adjusted during render (not an effect), so the box never paints the
  // previous search. Tested on `seenUrl`, never on `pushed`: it fires only
  // when the URL moves.
  if (urlValue !== seenUrl) {
    setSeenUrl(urlValue);
    // Somebody else's navigation; our own push falls through.
    if (urlValue !== pushed) {
      setPushed(urlValue);
      setTerm(urlValue);
    }
  }

  // What the URL will hand back: `/shop` trims `q`, so comparing the raw term
  // would read the shopper's own trailing space as a foreign navigation and
  // wipe the box mid-typing.
  const settled = term.trim();

  // A string, so the effect's dependencies are stable (the query object is
  // rebuilt every render). An empty box drops `q`.
  const nextHref = buildShopHref(
    updateShopQuery(query, { q: settled || undefined }),
  );

  const go = useCallback(() => {
    // Enter runs ahead of the debounce and the timer still fires: no double push.
    if (settled === pushed) return;
    setPushed(settled);
    startTransition(() => router.push(nextHref));
  }, [settled, pushed, nextHref, router]);

  useEffect(() => {
    if (settled === pushed) return;
    const timer = setTimeout(go, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [settled, pushed, go]);

  return (
    <form
      className="mb-5 max-w-xl"
      onSubmit={(event) => {
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
          // The API's cap: an over-long term degrades to no `q`, and the
          // re-sync would then wipe what the shopper is still typing.
          maxLength={MAX_SEARCH_TERM_LENGTH}
          autoComplete="off"
          aria-busy={pending}
          className={cn(
            controlClass(false),
            'focus-visible:ring-ring ps-11',
            pending && 'opacity-70',
          )}
          data-umami-event="shop-search-type"
        />
      </div>
    </form>
  );
}
