/**
 * Seed the demo catalog — the design prototype's six categories and eight
 * products, with their locally-bundled images.
 *
 *   pnpm seed-catalog
 *
 * Requires the database to be up (`docker compose --file docker-compose-dev.yaml up -d`)
 * and migrations applied (`pnpm migration:migrate`). Safe to re-run: it upserts.
 */
import 'dotenv/config';
import { seedCatalog } from '@/db/seed/catalog';

const { categories, products } = await seedCatalog();
console.log(`Seeded ${categories} categories and ${products} products`);
process.exit(0);
