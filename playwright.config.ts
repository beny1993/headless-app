// Loads .env before anything reads it, the way vitest.config.ts does: the
// migrate/seed commands and the dev server below all need the database. A
// worktree has no .env of its own — point this at the main checkout's with
// `DOTENV_CONFIG_PATH=<checkout>/.env pnpm test:e2e`.
import 'dotenv/config';
import { defineConfig } from '@playwright/test';

// Its own port, never :3000. That one is usually a developer's `pnpm dev`,
// possibly from another checkout on another branch, and nothing about a reused
// server says which code it runs. Better Auth trusts only the origin in
// NEXT_PUBLIC_APP_URL, so the server below is handed this URL as well.
const PORT = 3100;
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
      // The storefront is what shoppers reach from a phone. Checkout and admin
      // run at desktop width only.
      name: 'mobile',
      use: {
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
      testMatch: /storefront\.spec\.ts$/,
      dependencies: ['setup'],
    },
  ],
  webServer: {
    // All idempotent, so every run starts from the same catalog — the seed also
    // resets each seeded product's stock, which the checkout specs spend.
    command: `pnpm migration:migrate && pnpm seed-catalog && pnpm seed-shipping && pnpm dev --port ${PORT}`,
    // Readiness, not liveness: the server is up AND the database answers.
    url: `${baseURL}/api/ready`,
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
      APP_CONFIG_EMAIL_ENABLED: 'false',
      // A test run never touches the real bucket, error tracker or analytics.
      APP_CONFIG_STORAGE_PROVIDER: 'local',
      NEXT_PUBLIC_STORAGE_BASE_URL: '',
      NEXT_PUBLIC_SENTRY_DSN: '',
      NEXT_PUBLIC_UMAMI_SCRIPT_URL: '',
      NEXT_PUBLIC_UMAMI_WEBSITE_ID: '',
    },
  },
});
