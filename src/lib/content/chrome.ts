// The header + footer content, read once per request for the storefront's shared
// chrome. Server-only by construction: it reaches `SiteContentDao` → `@/db`, so a
// client bundle could never import it.
//
// Why `await connection()` and not `export const dynamic = 'force-dynamic'`:
// a Drizzle/`pg` read is NOT a Request-time API, so prerendering would await it
// like any promise and `next build` would open Postgres while prerendering the
// static routes — but the Docker image build has no database. `connection()`
// (`next/server`) marks this point request-time, excluding the read from
// prerender, exactly as the shipped docs prescribe for a synchronous DB driver
// (`04-functions/connection.md` § Synchronous database drivers). The layout stays
// `'auto'`; `not-found.tsx` sits outside every route group and takes no segment
// config, so `connection()` is the only live-read tool there.
//
// Consequence, checked in the PR: `/checkout/failed` and `/_not-found` become `ƒ`
// in the build legend, and `next build` still never touches Postgres.
//
// Cached in memory after `connection()` (`Story - Storefront Caching and
// Streaming`): every storefront page waited on this read before it could start,
// for content that changes when an admin saves. The admin API drops the entry on
// any content, category or product write — a saved header/footer destination
// resolves a category or product id to its current slug — so a save still shows
// on the very next render (`src/lib/cache/store.ts`).
import { connection } from 'next/server';
import { CACHE_TAGS, cached } from '@/lib/cache/store';
import type { LinkTargets } from '@/lib/content/link';
import type { ContentValues } from '@/lib/content/site-content';
import { loadLinkTargets } from '@/logic/content/link-targets';
import {
  CACHE_TTL_MS,
  storefrontCategories,
  storefrontContent,
} from '@/logic/storefront/cached-reads';

type SiteChrome = Pick<ContentValues, 'header' | 'footer'> & {
  /** The catalog slugs the header's and footer's saved destinations resolve to. */
  targets: LinkTargets;
};

export async function readSiteChrome(): Promise<SiteChrome> {
  await connection();
  const { SITE_CONTENT, CATEGORIES, PRODUCTS } = CACHE_TAGS;
  // Nested on purpose: the content and categories inside are entries of their
  // own, shared with the pages, and this one adds the resolved link targets.
  return cached(
    'site-chrome',
    { tags: [SITE_CONTENT, CATEGORIES, PRODUCTS], ttlMs: CACHE_TTL_MS },
    async () => {
      const [{ header, footer }, categories] = await Promise.all([
        storefrontContent(),
        storefrontCategories(),
      ]);
      return {
        header,
        footer,
        targets: await loadLinkTargets([header, footer], categories),
      };
    },
  );
}
