// All Drizzle DB access goes through DAOs like this one. Multi-DAO operations
// belong in src/logic/, not in route handlers or components. Never write raw SQL.
import { db } from '@/db';
import { categories } from '@/db/schema/catalog';

export class HealthDao {
  /**
   * Cheapest honest round-trip to Postgres, for the readiness probe.
   *
   * Deliberately a real query against a real table rather than `select 1`: it
   * keeps the no-raw-SQL rule, and it proves more. A bare `select 1` succeeds
   * against a reachable-but-unmigrated database — exactly the state a fresh
   * environment is in before the pre-deployment migration runs — so it would
   * report ready while every page 500s on a missing table. Reading one row from
   * `categories` proves the connection AND that the schema exists.
   *
   * Throws whatever the driver throws; the caller decides how to respond.
   */
  static async ping(): Promise<void> {
    await db.select({ id: categories.id }).from(categories).limit(1);
  }
}
