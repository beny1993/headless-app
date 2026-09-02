// Server-side authorization for API routes.
//
// `requireAdmin()` in `src/lib/auth/session.ts` guards admin *pages* by
// redirecting. An API cannot redirect, so this is the same rule expressed as
// status codes — and it is the half that actually matters: a page gate is a
// convenience for a browser, while the API is what an attacker calls directly.
//
// No admin route exists yet. When one lands (`Story - Admin Product
// Management`, `Story - Admin Orders and Dashboard`), it mounts `requireAdmin`
// and inherits the tests next to this file.
import type { Env, MiddlewareHandler } from 'hono';
import { ROLES, type Role } from '@/db/schema/auth';
import { isAuthenticatedUser } from '@/lib/auth';
import { apiError } from '@/lib/hono/envelope';

/** What the guards publish for downstream handlers. */
export type AuthedEnv = {
  Variables: {
    user: { id: string; role: string };
  };
};

const UNAUTHENTICATED_MESSAGE = 'برای این کار باید وارد شوی.';
const FORBIDDEN_MESSAGE = 'به این بخش دسترسی نداری.';

/**
 * The session, or `null` — including when the lookup itself throws.
 *
 * Fail closed. A session check that errored has not authorized anything, and
 * a database blip must never read as "let them in".
 */
const currentUser = async (headers: Headers) => {
  try {
    const session = await isAuthenticatedUser(headers);
    return session?.user ?? null;
  } catch (error) {
    console.error('[auth] session lookup failed', error);
    return null;
  }
};

/**
 * 401 without a session. Publishes `c.get('user')` for the handler.
 *
 * Customer-facing routes scope every read and write by that id rather than by
 * anything in the request — an id taken from the URL or the body is how an
 * IDOR gets written.
 */
export const requireAuth: MiddlewareHandler<Env & AuthedEnv> = async (
  c,
  next,
) => {
  const user = await currentUser(c.req.raw.headers);
  if (!user) return c.json(apiError(UNAUTHENTICATED_MESSAGE), 401);

  c.set('user', { id: user.id, role: String(user.role ?? '') });
  await next();
};

/**
 * 401 without a session, 403 without the admin role.
 *
 * The two are deliberately different answers: 401 means "sign in", which is
 * true and actionable, while 403 means "signing in again will not help". The
 * body says neither who is signed in nor what role they hold.
 */
export const requireAdmin: MiddlewareHandler<Env & AuthedEnv> = async (
  c,
  next,
) => {
  const user = await currentUser(c.req.raw.headers);
  if (!user) return c.json(apiError(UNAUTHENTICATED_MESSAGE), 401);

  // Compared against the ROLES constant, never a bare string, and by equality
  // rather than by "not customer" — an unrecognized role must deny.
  const role = user.role as Role | undefined;
  if (role !== ROLES.ADMIN) return c.json(apiError(FORBIDDEN_MESSAGE), 403);

  c.set('user', { id: user.id, role });
  await next();
};
