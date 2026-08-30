// Test-only support for the suites that need a real Postgres — constraint
// checks, uniqueness violations and seed idempotency cannot be proven against a
// mocked `db`.
//
// Those suites are wrapped in `describe.skipIf(!databaseReachable)`, so
// `pnpm test` stays green on a machine with no Docker while still exercising the
// database when one is up (`docker compose --file docker-compose-dev.yaml up --wait`).
// The probe runs at import time because `@/db` throws on import when
// APP_CONFIG_DATABASE_URL is unset — it must not be imported before we know.
//
// Unset and unreachable are deliberately *not* the same thing. Unset means this
// machine has no database and the suites skip. Set means somebody intended to
// run them, so a server that does not answer is a broken environment — it fails
// the run rather than reporting 45 quiet skips that read as green.
import { Pool } from 'pg';

const connectionString = process.env.APP_CONFIG_DATABASE_URL;

const probe = async (url: string) => {
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 2000,
  });
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
};

if (connectionString && !(await probe(connectionString))) {
  // No URL in the message: it carries the database password.
  throw new Error(
    'APP_CONFIG_DATABASE_URL is set but Postgres did not answer. Start it with ' +
      '`docker compose --file docker-compose-dev.yaml up --wait`, or unset the ' +
      'variable to skip the database-backed suites.',
  );
}

export const databaseReachable = Boolean(connectionString);

/**
 * The app's Drizzle client, or a null stand-in when there is no database. Only
 * ever dereferenced inside a `skipIf(!databaseReachable)` suite.
 */
export const testDb = databaseReachable
  ? (await import('@/db')).db
  : (null as unknown as (typeof import('@/db'))['db']);

/**
 * Imports a module that reaches `@/db` — a DAO, the seed runner — without
 * blowing up when there is no database. A static import of one of those throws
 * at collection time, before `skipIf` gets a chance to skip anything, so the
 * database-backed suites pull them in through here instead:
 *
 *   const { ProductDao } = await importWithDb(() => import('@/db/dao/ProductDao'));
 *
 * With no database the stand-in's members are undefined, which is safe because
 * every suite that touches them is skipped.
 */
export const importWithDb = async <T extends object>(
  load: () => Promise<T>,
): Promise<T> => (databaseReachable ? load() : ({} as T));
