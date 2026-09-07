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
    //
    // Force the local storage driver for the whole suite, overriding whatever
    // `.env` selects. Real LIARA_* credentials already sit in `.env`, so without
    // this a single `provider=s3` edit would let any `getStorageDriver().put`
    // test write to the live bucket during `pnpm test`. Belt-and-suspenders on
    // top of each upload suite's own pin; a test that genuinely needs `s3` must
    // opt in explicitly.
    env: { TZ: 'UTC', APP_CONFIG_STORAGE_PROVIDER: 'local' },
    // One file at a time. Seven suites talk to the *same* dev Postgres, and
    // some of what they exercise is table-wide by design — `otp_send_log`'s
    // prune takes a cutoff and no phone number, so a send in one worker
    // deletes another worker's fixture rows. Run in parallel it produced a
    // reproducible ~20% failure rate in the throttle suites; a flaky security
    // test is worse than a slow one, because it teaches people to re-run.
    // Revisit with a database per worker if the suite ever gets slow enough
    // to matter.
    fileParallelism: false,
  },
});
