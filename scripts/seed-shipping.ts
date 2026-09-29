/**
 * Seed the 31 Iranian provinces and their placeholder shipping rates.
 *
 *   pnpm seed-shipping
 *
 * Requires the database to be up (`docker compose --file docker-compose-dev.yaml up -d`)
 * and migrations applied (`pnpm migration:migrate`). Safe to re-run: it upserts
 * provinces by name and never resets a fee an admin has tuned.
 */
import './load-env';
import { seedShipping } from '@/db/seed/shipping';

const { provinces } = await seedShipping();
console.log(`Seeded ${provinces} provinces with shipping rates`);
process.exit(0);
