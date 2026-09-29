/**
 * Seed the demo catalog — the design prototype's categories and products, plus
 * the sub-categories under them, with their locally-bundled images.
 *
 *   pnpm seed-catalog
 *
 * Requires the database to be up (`docker compose --file docker-compose-dev.yaml up -d`)
 * and migrations applied (`pnpm migration:migrate`). Safe to re-run: it upserts.
 * It first switches off the `test-…`/`e2e-…` products a killed test run left
 * active, which would otherwise crowd the seeded ones off the shelves' first page.
 */
import './load-env';
import { ProductDao } from '@/db/dao/ProductDao';
import { seedCatalog } from '@/db/seed/catalog';

const swept = await ProductDao.deactivateStaleTestProducts();
console.log(`Switched off ${swept} leftover test products`);
const { categories, products } = await seedCatalog();
console.log(`Seeded ${categories} categories and ${products} products`);
process.exit(0);
