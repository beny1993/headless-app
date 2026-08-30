// Loads .env into process.env before the workers fork, so a developer with the
// dev Postgres up gets the database-backed suites (src/db/test-db.ts) instead of
// silently skipping them. A missing .env is a no-op — those suites then skip,
// which is what CI and a Docker-less machine should do.
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Run as the deployed container does — UTC — not as the developer's machine
    // does. On a Tehran-local host the Jalali formatter's `Asia/Tehran` pin is
    // invisible: its tests pass even when the pin is removed.
    env: { TZ: 'UTC' },
  },
});
