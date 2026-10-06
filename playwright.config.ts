// Loads .env before anything reads it, the way vitest.config.ts does: the
// migrate/seed commands and the dev server below all need the database. A
// worktree has no .env of its own — point this at the main checkout's with
// `DOTENV_CONFIG_PATH=<checkout>/.env pnpm test:e2e`.
import './scripts/load-env';
import { defineConfig } from '@playwright/test';
import { z } from 'zod';

import { API_PATHS } from './src/lib/constant/paths';

// Its own port, never :3000. That one is usually a developer's `pnpm dev`,
// possibly from another checkout on another branch, and nothing about a reused
// server says which code it runs. Better Auth trusts only the origin in
// NEXT_PUBLIC_APP_URL, so the server below is handed this URL as well.
//
// :3100 unless `E2E_PORT` says otherwise: two worktrees running the suite at
// once each need their own, or the second stops at «already used» — or, worse,
// one's cleanup takes the other's server down mid-run (2026-09-29).
const PORT = z.coerce
  .number()
  .int()
  .min(1024)
  .max(65535)
  .default(3100)
  .parse(process.env.E2E_PORT);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // One worker. Every spec shares one dev database and one dev server, and the
  // OTP send limit is counted per machine. A regression suite that flakes
  // teaches people to re-run it; one that is slow does not.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never' }]],
  // `next dev` compiles a route the first time it is hit, so the first visit to
  // each page takes seconds.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    // Bounds every click, `getAttribute` and `waitForResponse`, which otherwise
    // wait for as long as the test has left: one that ran the test out would
    // leave its `finally` no page to clean up with, and its rows in the shared
    // dev database.
    actionTimeout: 20_000,
    // ponytail: the installed Google Chrome, so no browser download. Switch to
    // `playwright install chromium` when CI needs a pinned browser.
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Signs a fresh customer and a fresh admin in once; the specs reuse the
    // saved sessions (e2e/auth.setup.ts).
    { name: 'setup', testMatch: /\.setup\.ts$/ },
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 800 } },
      dependencies: ['setup'],
    },
    {
      // Every spec again at a phone's width: QA verified each flow at both.
      name: 'mobile',
      use: {
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    // All idempotent, so every run starts from the same catalog — the seed also
    // resets each seeded product's stock, which the checkout specs spend.
    command: `pnpm migration:migrate && pnpm seed-catalog && pnpm seed-shipping && pnpm dev --port ${PORT}`,
    // Readiness, not liveness: the server is up AND the database answers.
    url: `${baseURL}${API_PATHS.READY}`,
    reuseExistingServer: false,
    timeout: 180_000,
    // Pinned over whatever .env says. An empty string wins over the file too:
    // @next/env never overwrites a variable that is already set.
    env: {
      NEXT_PUBLIC_APP_URL: baseURL,
      // The specs read the OTP off the login page, and only the console
      // driver's staging echo puts it there.
      APP_CONFIG_SMS_PROVIDER: 'console',
      APP_CONFIG_SHOW_OTP_IN_UI: 'true',
      APP_CONFIG_ZARINPAL_PROVIDER: 'mock',
      // Online payment is off by default; the gateway specs need the option.
      APP_CONFIG_ZARINPAL_ENABLED: 'true',
      // On, so the rate-limit spec can present a synthetic X-Real-IP and
      // spend its OWN budget. Off, that header is ignored, every request in the
      // run collapses into one bucket, and the spec would throttle the rest of
      // the suite instead of itself.
      APP_CONFIG_TRUST_REAL_IP_HEADER: 'true',
      // Off whatever .env says, or every storefront spec meets the maintenance
      // screen instead of the shop.
      APP_CONFIG_MAINTENANCE_MODE: '',
      // A test run never touches the real bucket, error tracker or analytics.
      APP_CONFIG_STORAGE_PROVIDER: 'local',
      NEXT_PUBLIC_STORAGE_BASE_URL: '',
      NEXT_PUBLIC_SENTRY_DSN: '',
      NEXT_PUBLIC_UMAMI_SCRIPT_URL: '',
      NEXT_PUBLIC_UMAMI_WEBSITE_ID: '',
    },
  },
});
