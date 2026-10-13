// @vitest-environment node
// The E2E suite's dev server builds into a folder of its own with Turbopack's
// dev cache off; every other server, `pnpm dev`, `next build` and the Docker
// image, keeps Next's defaults (next.config.ts says why).
//
// The config is loaded the way Next loads it — Node's own TypeScript support,
// in a child process — because its Sentry wrapper's `/config` entry does not
// resolve under the test runner (as in image-optimizer-patterns.test.ts).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type LoadedConfig = {
  distDir?: string;
  experimental?: { turbopackFileSystemCacheForDev?: boolean };
};

/** next.config.ts as loaded with `E2E_SERVER` set to `value`, or unset. */
const configWith = (value: string | undefined): LoadedConfig => {
  // Unset means unset even when this suite runs from a shell that exports it.
  const env = { ...process.env };
  delete env.E2E_SERVER;
  if (value !== undefined) env.E2E_SERVER = value;
  // The config refuses a bare-host storage URL; whatever .env holds for it is
  // not what this suite is about.
  env.NEXT_PUBLIC_STORAGE_BASE_URL = '';
  const printed = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const { default: config } = await import('./next.config.ts');" +
        "console.log('CONFIG=' + JSON.stringify({ distDir: config.distDir, experimental: config.experimental }));",
    ],
    {
      // The repo root, where next.config.ts sits beside this file.
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      env,
      encoding: 'utf8',
      // stderr captured, so a refused value fails with its message instead of
      // printing over the test run.
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const line = printed.split('\n').find((row) => row.startsWith('CONFIG='));
  return JSON.parse(line!.slice('CONFIG='.length));
};

// Each case starts Node and loads Sentry's config wrapper: about a second.
describe('the E2E server switch', { timeout: 20_000 }, () => {
  it.each([undefined, '', 'false'])(
    'leaves every other server on Next’s defaults (E2E_SERVER %s)',
    (value) => {
      const config = configWith(value);
      expect(config.distDir).toBeUndefined();
      // Sentry's wrapper fills `experimental` with keys of its own.
      expect(
        config.experimental?.turbopackFileSystemCacheForDev,
      ).toBeUndefined();
    },
  );

  it('gives the E2E server its own folder and no dev cache', () => {
    const config = configWith('true');
    expect(config.distDir).toBe('.next-e2e');
    expect(config.experimental?.turbopackFileSystemCacheForDev).toBe(false);
  });

  it('refuses a value it cannot read instead of guessing', () => {
    expect(() => configWith('yes please')).toThrow(
      /E2E_SERVER must be "true", "false" or unset, got "yes please"/,
    );
  });
});
