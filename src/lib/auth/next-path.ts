// Where to send someone after they sign in.
//
// `/login?next=…` is an open redirect waiting to happen: the classic phishing
// shape is a link to the *real* site whose login bounces the visitor to a fake
// one straight after they authenticate. The rule here is deliberately blunt —
// a destination is a path on this site or it is the home page. There is no
// allowlist of external hosts to get wrong later.
//
// **Nothing in this file may import drizzle, `pg` or `@hono/zod-openapi`**: the
// login form is a client component and imports it.
import * as z from 'zod';
import { PATHS } from '@/lib/constant/paths';

/** Longer than any route this site has; a cap before any of the work below. */
const MAX_NEXT_LENGTH = 512;

/**
 * Anything that could end a path early or start a new line: NUL, the C0
 * controls, DEL.
 *
 * A code-point test rather than a regex on purpose. The literal character class
 * would put raw control bytes in this file, which is exactly what AGENTS.md
 * forbids — invisible to review and to every diff — and the escaped form still
 * trips `no-control-regex`, which would need a suppression comment nobody
 * should have to trust.
 */
const hasControlCharacter = (value: string) =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });

/**
 * A safe post-login destination, or the storefront home page.
 *
 * Accepts only a path that begins with a single `/`. That one rule covers the
 * whole family at once:
 *
 * - `https://evil.example` — no leading slash.
 * - `//evil.example` — protocol-relative; browsers treat it as another origin.
 * - `/\evil.example` — the same trick, since browsers normalize `\` to `/`.
 * - `../admin-panel` — relative, and meaningless without a base anyway.
 *
 * Never throws: this reads a query parameter a stranger controls, and a login
 * page that 500s on a tampered URL is worse than one that ignores it.
 */
export function safeNextPath(value: unknown): string {
  if (typeof value !== 'string') return PATHS.HOME;
  if (value.length === 0 || value.length > MAX_NEXT_LENGTH) return PATHS.HOME;
  // Reject rather than trim: a value that needed trimming was crafted.
  if (value !== value.trim()) return PATHS.HOME;
  if (hasControlCharacter(value)) return PATHS.HOME;

  if (!value.startsWith('/')) return PATHS.HOME;
  // Second character decides origin: `//` and `/\` both leave this site.
  const second = value[1];
  if (second === '/' || second === '\\') return PATHS.HOME;

  return value;
}

/**
 * The zod boundary for `?next=` on the login page's `searchParams`, which can
 * hand over a string, an array (a repeated parameter) or nothing at all.
 * Degrades rather than rejecting, per the repo's page-input convention.
 */
export const nextPathSchema = z.unknown().transform(safeNextPath);

/** `/login`, carrying where to return to — omitted when that is home. */
export function loginPath(next?: string): string {
  const destination = safeNextPath(next);
  return destination === PATHS.HOME
    ? PATHS.LOGIN
    : `${PATHS.LOGIN}?next=${encodeURIComponent(destination)}`;
}
