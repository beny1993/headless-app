import { afterEach, describe, expect, it, vi } from 'vitest';

import { VARS } from '@/lib/utils/env';

// The module reads the env flag at call time, not at import time, so each case
// sets the variable and imports fresh.
const load = async () => {
  vi.resetModules();
  return import('./client-ip');
};

const withHeaders = (init: Record<string, string>) => new Headers(init);

afterEach(() => {
  delete process.env[VARS.APP_CONFIG_TRUST_REAL_IP_HEADER];
  vi.resetModules();
});

describe('clientIpHeaders', () => {
  it('omits x-real-ip by default, so an un-proxied deploy fails safe', async () => {
    const { clientIpHeaders } = await load();

    expect(clientIpHeaders()).toEqual(['x-forwarded-for']);
  });

  it('puts x-real-ip first when the deploy declares a trusted proxy', async () => {
    process.env[VARS.APP_CONFIG_TRUST_REAL_IP_HEADER] = 'true';
    const { clientIpHeaders } = await load();

    expect(clientIpHeaders()).toEqual(['x-real-ip', 'x-forwarded-for']);
  });

  it('reads a padded " true " as on, like every other flag', async () => {
    process.env[VARS.APP_CONFIG_TRUST_REAL_IP_HEADER] = ' true ';
    const { clientIpHeaders } = await load();

    expect(clientIpHeaders()).toEqual(['x-real-ip', 'x-forwarded-for']);
  });

  it('treats any value other than "true" as off — a typo must not open the header', async () => {
    for (const value of ['false', '1', 'yes', 'TRUE', '']) {
      process.env[VARS.APP_CONFIG_TRUST_REAL_IP_HEADER] = value;
      const { clientIpHeaders } = await load();

      expect(clientIpHeaders()).toEqual(['x-forwarded-for']);
    }
  });
});

describe('clientIpFrom', () => {
  it('ignores a forged x-real-ip while the flag is off', async () => {
    const { clientIpFrom } = await load();

    const ip = clientIpFrom(
      withHeaders({
        'x-real-ip': '10.99.0.1',
        'x-forwarded-for': '10.99.0.2',
      }),
    );

    expect(ip).toBe('10.99.0.2');
  });

  it('prefers x-real-ip over x-forwarded-for once the flag is on', async () => {
    process.env[VARS.APP_CONFIG_TRUST_REAL_IP_HEADER] = 'true';
    const { clientIpFrom } = await load();

    const ip = clientIpFrom(
      withHeaders({
        'x-real-ip': '10.99.0.1',
        'x-forwarded-for': '10.99.0.2',
      }),
    );

    expect(ip).toBe('10.99.0.1');
  });

  it('reads a single-hop x-forwarded-for', async () => {
    const { clientIpFrom } = await load();

    expect(clientIpFrom(withHeaders({ 'x-forwarded-for': '10.99.0.7' }))).toBe(
      '10.99.0.7',
    );
  });

  // The next two pin the security property, not the sentinel value: what must
  // never happen is the caller *choosing* their own bucket. Better Auth answers
  // `null` in production and `127.0.0.1` under NODE_ENV development/test, so
  // asserting a literal `null` here would pass or fail on the environment
  // rather than on the behaviour. Either way every such request shares one
  // bucket, which is the point.
  it('refuses a multi-hop x-forwarded-for rather than trusting the first entry', async () => {
    const { clientIpFrom } = await load();

    expect(
      clientIpFrom(withHeaders({ 'x-forwarded-for': '10.99.0.7, 10.0.0.1' })),
    ).not.toBe('10.99.0.7');
  });

  it('does not resolve junk to anything the caller supplied', async () => {
    const { clientIpFrom } = await load();

    expect(
      clientIpFrom(withHeaders({ 'x-forwarded-for': 'not-an-ip' })),
    ).not.toBe('not-an-ip');
  });

  it('collapses every unresolvable caller onto one shared bucket', async () => {
    const { clientIpFrom } = await load();

    const first = clientIpFrom(withHeaders({ 'x-forwarded-for': 'junk-a' }));
    const second = clientIpFrom(
      withHeaders({ 'x-forwarded-for': 'junk-b, 10.0.0.1' }),
    );
    const third = clientIpFrom(new Headers());

    expect(first).toBe(second);
    expect(second).toBe(third);
  });
});
