import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { getEnvVariable, VARS } from '@/lib/utils/env';
import * as schema from './schema';

const pool = new Pool({
  connectionString: getEnvVariable(VARS.APP_CONFIG_DATABASE_URL, true),
});

export const db = drizzle(pool, { schema });

/**
 * One connection of the pool, inside a transaction — drizzle names the type
 * only as the argument of the callback it hands to `db.transaction`.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Whatever a query or a write can run on: the pool, or a transaction on one
 * connection of it. A DAO method that takes this composes into a caller's
 * transaction — checkout's, a guard's — and is equally correct on its own.
 *
 * Here rather than in any one DAO, because it is a fact about `db` and every
 * DAO needs it. It had grown three separate local copies and one exported from
 * `OrderDao`, which is how a type about the database ended up making the
 * category manager import from the order module.
 */
export type Executor = typeof db | Tx;
