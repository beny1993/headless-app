'use client';

import { useCallback, useEffect, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { buildShopHref, updateShopQuery, type ShopQuery } from './shop-query';
import { MAX_SEARCH_TERM_LENGTH } from '@/lib/catalog/product-query';
import { cn } from '@/lib/utils';
import { controlClass } from '@/components/ui/field';

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
 * One invariant holds the whole thing together: **re-sync the box only when the
 * URL changes to a value this component did not push.** The back button, a
 * shared link and the empty state's clear-search link all move the URL to
 * something nobody typed here, and the box has to follow them. Our own push
 * moves it to what is already in the box, and must not touch it — the shopper
 * keeps typing while the round trip is in flight, and re-syncing on our own
 * navigation throws those characters away.
 *
 * Which takes three pieces of state, and the split between the last two is the
 * whole trick. `term` is what is in the box. `seenUrl` is the `q` this
 * component last rendered against — it tracks the prop and nothing else, so it
 * answers «did the URL move?». `pushed` is the term we asked the router for —
 * it answers «was that us?». Collapsing the two, as an earlier version did,
 * makes the first question unanswerable: between the debounce firing and the
 * response landing, the URL and our intention disagree by construction, and the
 * box reads its own push as somebody else's navigation.
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
  /** The last `q` this component has actually rendered against. */
  const [seenUrl, setSeenUrl] = useState(urlValue);
  /** The last term this component asked the router for. */
  const [pushed, setPushed] = useState(urlValue);

  // Adjusting state during render rather than in an effect, which is React's
  // own answer for "a prop changed and some state derives from it": it settles
  // before the browser paints, so the box never shows the previous search for a
  // frame.
  //
  // The outer test is on `seenUrl`, which only ever takes `urlValue`'s own
  // value — so it fires when the URL *moves*, terminates on the next render,
  // and is deaf to anything this component merely intends. That is the whole
  // repair: an earlier version tested `urlValue` against the term it had just
  // pushed, which disagree for the entire round trip, so every search wiped the
  // box to empty the moment the debounce fired and refilled it from the URL a
  // request later — taking anything typed in between with it.
  if (urlValue !== seenUrl) {
    setSeenUrl(urlValue);
    // The URL moved to something this box did not ask for: the back button, a
    // shared link, the empty state's clear-search link. Our own push lands here
    // too, and falls through — leaving whatever has been typed since alone.
    if (urlValue !== pushed) {
      setPushed(urlValue);
      setTerm(urlValue);
    }
  }

  // What the box holds, reduced to what the URL can actually carry back.
  //
  // `/shop` trims `q` before its schema sees it, so a term with a space on
  // either end never returns as it was sent. Comparing against the raw `term`
  // would therefore read the shopper's own trailing space as somebody else's
  // navigation and re-sync the box to the trimmed value — deleting the space
  // between two words as they type, and with it anything typed while our own
  // push was still in flight. The same wipe the `maxLength` below prevents,
  // reached through the trim instead of the cap: what this component compares
  // and stores has to be the term the URL will hand back, not the keystrokes.
  const settled = term.trim();

  // The URL this box is heading for, built during render because it is a pure
  // function of what is on screen. It is also a plain string, which is what
  // lets the effect below name every one of its dependencies honestly: the
  // query object is rebuilt on every render and would restart the debounce on
  // renders that had nothing to do with typing.
  //
  // An empty box is no search rather than a search for nothing —
  // `updateShopQuery` drops the parameter and the URL is the plain listing again.
  const nextHref = buildShopHref(
    updateShopQuery(query, { q: settled || undefined }),
  );

  const go = useCallback(() => {
    // Enter runs this ahead of the debounce and the pending timer still fires
    // afterwards — without this guard the second run pushes the same href
    // again and costs the shopper two presses of the back button.
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
          // The API's own cap, enforced by the browser so the box can never
          // hold a term the page would then throw away. Without it the two
          // halves of this component turn on each other: an over-long term is
          // pushed, `/shop` degrades an invalid parameter to an absent one, and
          // the re-sync above — correctly seeing a URL that disagrees with what
          // it last pushed — wipes what the shopper is still typing.
          maxLength={MAX_SEARCH_TERM_LENGTH}
          // `type="search"` brings the browser's own clear button, and clearing
          // it fires `change` like any other edit — so the box empties, the
          // debounce runs, and the URL loses its `q`.
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
