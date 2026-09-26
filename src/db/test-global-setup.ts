// Vitest globalSetup: before any suite runs, switch off the `test-…`/`e2e-…`
// products an earlier run left active when it was killed before its afterAll
// cleanup (see `ProductDao.deactivateStaleTestProducts`). Same contract as
// ./test-db.ts, whose probe runs on import: unset URL skips silently, a set URL
// with no server answering fails the run.
import { databaseReachable, importWithDb } from '@/db/test-db';

export default async function setup() {
  if (!databaseReachable) return;
  const { ProductDao } = await importWithDb(
    () => import('@/db/dao/ProductDao'),
  );
  const { closeDb } = await importWithDb(() => import('@/db'));
  try {
    await ProductDao.deactivateStaleTestProducts();
  } finally {
    // An idle pool would hold this (the main) process open ~10s after the run.
    await closeDb();
  }
}
