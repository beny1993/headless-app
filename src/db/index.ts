import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { getEnvVariable, VARS } from '@/lib/utils/env';
import * as schema from './schema';

const pool = new Pool({
  connectionString: getEnvVariable(VARS.APP_CONFIG_DATABASE_URL, true),
});

export const db = drizzle(pool, { schema });
