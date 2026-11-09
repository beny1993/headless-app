// @vitest-environment node
// The image optimizer's allowlist (next.config.ts) reaches the bucket's
// `uploads/` only — the product photos `imageSrc` builds bucket URLs for. A
// receipt under `receipts/` fetched through `/_next/image` would come back
// public and cacheable from the shop's own origin.
//
// The config is loaded the way Next loads it — Node's own TypeScript support,
// in a child process — because its Sentry wrapper's `/config` entry does not
// resolve under the test runner.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const remotePatternsFor = (base: string): unknown => {
  const printed = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const { default: config } = await import('./next.config.ts');" +
        "console.log('PATTERNS=' + JSON.stringify(config.images?.remotePatterns ?? null));",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, NEXT_PUBLIC_STORAGE_BASE_URL: base },
      encoding: 'utf8',
    },
  );
  const line = printed.split('\n').find((row) => row.startsWith('PATTERNS='));
  return JSON.parse(line!.slice('PATTERNS='.length));
};

describe('the image optimizer allowlist', () => {
  it('reaches the bucket’s uploads/ only, never its receipts/', () => {
    expect(remotePatternsFor('https://storage.c2.liara.site/demoshop')).toEqual(
      [
        {
          protocol: 'https',
          hostname: 'storage.c2.liara.site',
          port: '',
          pathname: '/demoshop/uploads/**',
        },
      ],
    );
  });

  it('allows nothing remote when there is no bucket', () => {
    expect(remotePatternsFor('')).toEqual([]);
  });
});
