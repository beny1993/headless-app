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
// in the build legend, and `next build` still never touches Postgres. There is no
// cache and nothing to invalidate — a saved header/footer shows on the very next
// render of every page's layout and of a 404.
//
// ponytail: two PK reads per request (this + the page's own area). React `cache()`
// dedupe pays only if one `getAll()` replaces the per-area `getMany`; wrap a
// `cache()`-ed getAll if it ever shows in p95.
// Saved header/footer destinations add at most a category list and a
// products-by-id read, and only when one of those links names a category or a
// product (`loadLinkTargets`).
import { connection } from 'next/server';
import { SiteContentDao } from '@/db/dao/SiteContentDao';
import type { LinkTargets } from '@/lib/content/link';
import type { ContentValues } from '@/lib/content/site-content';
import { loadLinkTargets } from '@/logic/content/link-targets';

export type SiteChrome = Pick<ContentValues, 'header' | 'footer'> & {
  /** The catalog slugs the header's and footer's saved destinations resolve to. */
  targets: LinkTargets;
};

export async function readSiteChrome(): Promise<SiteChrome> {
  await connection();
  const { header, footer } = await SiteContentDao.getMany(['header', 'footer']);
  return { header, footer, targets: await loadLinkTargets([header, footer]) };
}
