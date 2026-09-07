// Applies pending Drizzle migrations against APP_CONFIG_DATABASE_URL.
//
// Deliberately plain ESM JavaScript, not TypeScript: this runs inside the
// production image, which carries no devDependencies — no tsx, no drizzle-kit.
// It leans only on `drizzle-orm` + `pg`, both of which the app already depends
// on at runtime. Local development keeps using `pnpm migration:migrate`
// (drizzle-kit), which additionally generates migrations; this one only applies
// them.
//
// Wire it as Coolify's pre-deployment command:  node scripts/migrate.mjs
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { fileURLToPath, URL } from 'node:url';

const connectionString = process.env.APP_CONFIG_DATABASE_URL;
if (!connectionString) {
  console.error('APP_CONFIG_DATABASE_URL is required and not set');
  process.exit(1);
}

// Resolved relative to this file so it works from any working directory —
// /app/scripts/migrate.mjs -> /app/src/db/migrations in the image.
// fileURLToPath, not the URL itself: drizzle joins this with 'meta/_journal.json'
// as a plain path, and a URL object stringifies to file:// which breaks that.
const migrationsFolder = fileURLToPath(
  new URL('../src/db/migrations', import.meta.url),
);

const pool = new pg.Pool({ connectionString });
try {
  await migrate(drizzle(pool), { migrationsFolder });
  console.log('migrations applied');
} catch (error) {
  console.error(
    'migration failed:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
