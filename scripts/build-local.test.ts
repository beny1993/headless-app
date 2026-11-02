import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = join(process.cwd(), 'scripts/build-local.mjs');

/** The Dockerfile build stage's throwaway values. */
const PLACEHOLDERS = {
  APP_CONFIG_DATABASE_URL: 'postgres://build:build@127.0.0.1:5432/build',
  APP_CONFIG_AUTH_SECRET: 'build-time-placeholder-not-used-at-runtime',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'build-local-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const writeEnvFile = (name: string, contents: string) =>
  writeFileSync(join(dir, name), contents);

/**
 * Runs the script in the temp checkout with a stand-in `next` first on PATH:
 * it prints what it was started with, then exits with `exitCode`.
 *
 * The environment is built from scratch rather than inherited, because this
 * test process has already loaded the developer's own .env (vitest.config.ts).
 */
function runBuildLocal(shellEnv: Record<string, string> = {}, exitCode = 0) {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const next = join(bin, 'next');
  writeFileSync(
    next,
    [
      '#!/bin/sh',
      `printf '%s\\n' "$APP_CONFIG_DATABASE_URL" "$APP_CONFIG_AUTH_SECRET" "$NEXT_PUBLIC_APP_URL" "$__NEXT_PROCESSED_ENV" "$*"`,
      `exit ${exitCode}`,
    ].join('\n'),
  );
  chmodSync(next, 0o755);

  // NODE_ENV as `next build` sets it (and as ProcessEnv requires one).
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    PATH: `${bin}:${process.env.PATH}`,
    ...shellEnv,
  };
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    encoding: 'utf8',
    env,
  });
  const [databaseUrl, authSecret, appUrl, processedFlag, args] =
    result.stdout.split('\n');
  return {
    status: result.status,
    env: {
      APP_CONFIG_DATABASE_URL: databaseUrl,
      APP_CONFIG_AUTH_SECRET: authSecret,
      NEXT_PUBLIC_APP_URL: appUrl,
    },
    processedFlag,
    args,
  };
}

describe('scripts/build-local.mjs', () => {
  it('runs next build on the placeholders when nothing sets the variables', () => {
    const run = runBuildLocal();

    expect(run.status).toBe(0);
    expect(run.args).toBe('build');
    expect(run.env).toEqual(PLACEHOLDERS);
    // Cleared, so `next build` loads the env files itself as it always does.
    expect(run.processedFlag).toBe('');
  });

  it('keeps every value a .env file sets', () => {
    writeEnvFile(
      '.env',
      [
        'APP_CONFIG_DATABASE_URL=postgres://shop:secret@db.internal:5432/shop',
        'APP_CONFIG_AUTH_SECRET=a-real-secret',
        'NEXT_PUBLIC_APP_URL=https://shop.example',
      ].join('\n'),
    );

    expect(runBuildLocal().env).toEqual({
      APP_CONFIG_DATABASE_URL: 'postgres://shop:secret@db.internal:5432/shop',
      APP_CONFIG_AUTH_SECRET: 'a-real-secret',
      NEXT_PUBLIC_APP_URL: 'https://shop.example',
    });
  });

  it('reads the other env files next build loads, such as .env.local', () => {
    writeEnvFile('.env.local', 'NEXT_PUBLIC_APP_URL=https://staging.example');

    expect(runBuildLocal().env).toEqual({
      ...PLACEHOLDERS,
      NEXT_PUBLIC_APP_URL: 'https://staging.example',
    });
  });

  it('keeps a value the shell sets over the one in .env', () => {
    writeEnvFile('.env', 'APP_CONFIG_AUTH_SECRET=from-the-file');

    const run = runBuildLocal({ APP_CONFIG_AUTH_SECRET: 'from-the-shell' });

    expect(run.env.APP_CONFIG_AUTH_SECRET).toBe('from-the-shell');
  });

  it('fills a variable .env leaves empty, as a copied .env.example does', () => {
    writeEnvFile('.env', 'APP_CONFIG_AUTH_SECRET=');

    expect(runBuildLocal().env.APP_CONFIG_AUTH_SECRET).toBe(
      PLACEHOLDERS.APP_CONFIG_AUTH_SECRET,
    );
  });

  it('exits with the status next build exits with', () => {
    expect(runBuildLocal({}, 3).status).toBe(3);
  });
});
