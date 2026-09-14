// `pnpm build:local` — `next build` for a checkout with no .env, which is every
// agent worktree, and so every push from one: the pre-push hook runs this.
// Collecting page data imports the auth and db modules, and they demand these
// values; the Dockerfile's build stage passes the same throwaway ones.
//
// Each is filled in only when neither the shell nor an env file Next loads sets
// it, so a real value always wins. Nothing connects to the database or checks
// the secret while building, but NEXT_PUBLIC_APP_URL is inlined into the
// output: a build made on these is for checking, never for deploying. Plain
// `pnpm build` fills nothing, so a real build still needs real values.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const BUILD_PLACEHOLDERS = {
  APP_CONFIG_DATABASE_URL: 'postgres://build:build@127.0.0.1:5432/build',
  APP_CONFIG_AUTH_SECRET: 'build-time-placeholder-not-used-at-runtime',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
};

// Next's own loader, so the same env files count, in the same order. pnpm only
// exposes @next/env to next itself, so it is resolved from there.
const nextEntry = createRequire(import.meta.url).resolve('next');
const { loadEnvConfig } = createRequire(nextEntry)('@next/env');

loadEnvConfig(process.cwd(), false, { info() {}, error: console.error });
for (const [name, placeholder] of Object.entries(BUILD_PLACEHOLDERS)) {
  process.env[name] ||= placeholder;
}
// The load above marks the env as processed; left set, `next build` would skip
// loading the env files itself.
delete process.env.__NEXT_PROCESSED_ENV;

const { status, error } = spawnSync(
  'next',
  ['build', ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
if (error) throw error;
process.exit(status ?? 1);
