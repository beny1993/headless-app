import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://analytics.example.test';
const WEBSITE = '0c6a3f3e-7d2b-4c1e-9a8f-2b7c1d9e4f10';
const NOW = new Date('2026-10-11T10:00:00.000Z');
const DAY_MS = 24 * 60 * 60_000;

type Call = { url: URL; init: RequestInit };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

let calls: Call[];
let fetchMock: ReturnType<typeof vi.fn>;

/** Answers in order; each entry is a Response or a function of the call. */
const answer = (...replies: (Response | ((call: Call) => Response))[]) => {
  fetchMock.mockImplementation(async (input: string, init: RequestInit) => {
    const call = { url: new URL(input), init };
    calls.push(call);
    const next = replies.shift();
    if (!next) throw new Error(`unexpected fetch ${input}`);
    return typeof next === 'function' ? next(call) : next;
  });
};

const login = (token = 'tok-1') => json({ token, user: { id: 'u' } });
const metrics = (rows: { x: string | null; y: number }[]) => json(rows);

const configure = ({
  scriptUrl = `${ORIGIN}/script.js`,
  websiteId = WEBSITE,
  username = 'viewer',
  password = 'p@ss word',
} = {}) => {
  vi.stubEnv('NEXT_PUBLIC_UMAMI_SCRIPT_URL', scriptUrl);
  vi.stubEnv('NEXT_PUBLIC_UMAMI_WEBSITE_ID', websiteId);
  vi.stubEnv('APP_CONFIG_UMAMI_USERNAME', username);
  vi.stubEnv('APP_CONFIG_UMAMI_PASSWORD', password);
};

/** A fresh module: the token, the detected version and the cache start empty. */
const load = async () => {
  vi.resetModules();
  return import('./client');
};

beforeEach(() => {
  calls = [];
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('readUmamiMetric', () => {
  describe('configuration', () => {
    it.each([
      ['script URL', { scriptUrl: '' }],
      ['website id', { websiteId: '' }],
      ['username', { username: '' }],
      ['password', { password: '' }],
      ['script URL that is not a URL', { scriptUrl: 'analytics' }],
      ['script URL that is not http(s)', { scriptUrl: 'ftp://a.test/s.js' }],
      ['blank username', { username: '   ' }],
    ])('is off, and never fetches, without a %s', async (_label, override) => {
      configure(override);
      const { readUmamiMetric } = await load();
      expect(await readUmamiMetric('pages', 30, NOW)).toEqual({
        status: 'off',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('the transport', () => {
    beforeEach(() => configure());

    it('shares one deadline across every request of a read', async () => {
      answer(
        login('old'),
        metrics([]),
        json({}, 401),
        login('new'),
        json({}, 400),
        metrics([]),
      );
      const { readUmamiMetric } = await load();
      await readUmamiMetric('pages', 30, NOW);
      expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
      // The second read: stale token, sign-in, v3 fallback — four requests.
      await readUmamiMetric('pages', 7, NOW);
      const second = calls.slice(2).map(({ init }) => init.signal);
      expect(second).toHaveLength(4);
      expect(new Set(second).size).toBe(1);
      expect(second[0]).not.toBe(calls[0]!.init.signal);
    });

    it('never follows a redirect, so the password cannot be resent elsewhere', async () => {
      answer(login(), metrics([]));
      const { readUmamiMetric } = await load();
      await readUmamiMetric('pages', 30, NOW);
      expect(calls.map(({ init }) => init.redirect)).toEqual([
        'error',
        'error',
      ]);
    });

    it('refuses a plain-http Umami in a deployed build', async () => {
      configure({ scriptUrl: 'http://analytics.example.test/script.js' });
      vi.stubEnv('NODE_ENV', 'production');
      const { readUmamiMetric } = await load();
      expect(await readUmamiMetric('pages', 30, NOW)).toEqual({
        status: 'off',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('allows a plain-http stand-in outside a deployed build', async () => {
      configure({ scriptUrl: 'http://localhost:4545/script.js' });
      answer(login(), metrics([]));
      const { readUmamiMetric } = await load();
      expect(await readUmamiMetric('pages', 30, NOW)).toEqual({
        status: 'ok',
        rows: [],
      });
      expect(calls[0]!.url.origin).toBe('http://localhost:4545');
    });
  });

  describe('a working Umami', () => {
    beforeEach(() => configure());

    it('signs in at the script origin with the view-only user', async () => {
      answer(login(), metrics([]));
      const { readUmamiMetric } = await load();
      await readUmamiMetric('pages', 30, NOW);

      const [signIn] = calls;
      expect(signIn!.url.href).toBe(`${ORIGIN}/api/auth/login`);
      expect(signIn!.init.method).toBe('POST');
      expect(JSON.parse(signIn!.init.body as string)).toEqual({
        username: 'viewer',
        password: 'p@ss word',
      });
    });

    it('asks for the window ending now, with the bearer token', async () => {
      answer(login('tok-xyz'), metrics([]));
      const { readUmamiMetric } = await load();
      await readUmamiMetric('pages', 7, NOW);

      const request = calls[1]!;
      expect(request.url.origin + request.url.pathname).toBe(
        `${ORIGIN}/api/websites/${WEBSITE}/metrics`,
      );
      expect(request.url.searchParams.get('type')).toBe('url');
      expect(Number(request.url.searchParams.get('endAt'))).toBe(NOW.getTime());
      expect(Number(request.url.searchParams.get('startAt'))).toBe(
        NOW.getTime() - 7 * DAY_MS,
      );
      expect(
        (request.init.headers as Record<string, string>).authorization,
      ).toBe('Bearer tok-xyz');
      expect(request.init.signal).toBeInstanceOf(AbortSignal);
    });

    it('returns the rows as key and count', async () => {
      answer(
        login(),
        metrics([
          { x: '/product/cat-food', y: 12 },
          { x: '/', y: 40 },
        ]),
      );
      const { readUmamiMetric } = await load();
      expect(await readUmamiMetric('pages', 30, NOW)).toEqual({
        status: 'ok',
        rows: [
          { key: '/product/cat-food', count: 12 },
          { key: '/', count: 40 },
        ],
      });
    });

    it('reads referrers by the referrer metric, dropping the «(none)» bucket', async () => {
      answer(
        login(),
        metrics([
          { x: 'instagram.com', y: 9 },
          { x: null, y: 100 },
        ]),
      );
      const { readUmamiMetric } = await load();
      const result = await readUmamiMetric('referrers', 30, NOW);
      expect(calls[1]!.url.searchParams.get('type')).toBe('referrer');
      expect(result).toEqual({
        status: 'ok',
        rows: [{ key: 'instagram.com', count: 9 }],
      });
    });

    it('reuses the token across reads', async () => {
      answer(login(), metrics([]), metrics([]));
      const { readUmamiMetric } = await load();
      await readUmamiMetric('pages', 30, NOW);
      await readUmamiMetric('referrers', 30, NOW);
      expect(
        calls.filter(({ url }) => url.pathname === '/api/auth/login'),
      ).toHaveLength(1);
    });
  });

  describe('concurrent reads', () => {
    beforeEach(() => configure());

    it('share one sign-in when both metrics are read at once', async () => {
      answer(login(), metrics([{ x: '/product/a', y: 1 }]), metrics([]));
      const { readUmamiMetric } = await load();
      const [pages, referrers] = await Promise.all([
        readUmamiMetric('pages', 30, NOW),
        readUmamiMetric('referrers', 30, NOW),
      ]);
      expect(pages.status).toBe('ok');
      expect(referrers.status).toBe('ok');
      expect(
        calls.filter(({ url }) => url.pathname === '/api/auth/login'),
      ).toHaveLength(1);
    });

    it('share one read of the same window', async () => {
      answer(login(), metrics([{ x: '/product/a', y: 1 }]));
      const { readUmamiMetric } = await load();
      const [first, second] = await Promise.all([
        readUmamiMetric('pages', 30, NOW),
        readUmamiMetric('pages', 30, NOW),
      ]);
      expect(second).toEqual(first);
      expect(calls).toHaveLength(2);
    });
  });

  describe('Umami v3', () => {
    beforeEach(() => configure());

    it('falls back from `url` to `path` on a 400, and remembers', async () => {
      answer(
        login(),
        json({ error: 'bad type' }, 400),
        metrics([{ x: '/product/a', y: 3 }]),
        metrics([{ x: '/product/a', y: 4 }]),
      );
      const { readUmamiMetric } = await load();

      expect(await readUmamiMetric('pages', 30, NOW)).toEqual({
        status: 'ok',
        rows: [{ key: '/product/a', count: 3 }],
      });
      expect(calls.map(({ url }) => url.searchParams.get('type'))).toEqual([
        null,
        'url',
        'path',
      ]);

      // The next window goes straight to `path`.
      await readUmamiMetric('pages', 7, NOW);
      expect(calls[3]!.url.searchParams.get('type')).toBe('path');
    });

    it('never retries a referrer read as `path`', async () => {
      answer(login(), json({}, 400));
      const { readUmamiMetric } = await load();
      expect(await readUmamiMetric('referrers', 30, NOW)).toEqual({
        status: 'unavailable',
      });
      expect(calls).toHaveLength(2);
    });
  });

  describe('an expired token', () => {
    beforeEach(() => configure());

    it('signs in again once on a 401 and retries', async () => {
      answer(
        login('old'),
        metrics([]),
        json({}, 401),
        login('new'),
        metrics([{ x: '/product/a', y: 1 }]),
      );
      const { readUmamiMetric } = await load();
      await readUmamiMetric('pages', 30, NOW);
      const result = await readUmamiMetric('pages', 7, NOW);

      expect(result).toEqual({
        status: 'ok',
        rows: [{ key: '/product/a', count: 1 }],
      });
      expect(
        (calls[4]!.init.headers as Record<string, string>).authorization,
      ).toBe('Bearer new');
    });

    it('gives up, rather than looping, when a fresh token is refused too', async () => {
      answer(login(), json({}, 401));
      const { readUmamiMetric } = await load();
      expect(await readUmamiMetric('pages', 30, NOW)).toEqual({
        status: 'unavailable',
      });
      expect(calls).toHaveLength(2);
    });

    it('signs in afresh on the next read after a refused token', async () => {
      answer(login('a'), json({}, 401), login('b'), metrics([]));
      const { readUmamiMetric } = await load();
      await readUmamiMetric('pages', 30, NOW);
      expect(await readUmamiMetric('pages', 7, NOW)).toEqual({
        status: 'ok',
        rows: [],
      });
      expect(calls[2]!.url.pathname).toBe('/api/auth/login');
    });
  });

  describe('failures are `unavailable`, never a throw', () => {
    beforeEach(() => configure());

    it.each([
      ['a refused sign-in', () => answer(json({}, 401))],
      ['a sign-in with no token', () => answer(json({ user: {} }))],
      ['a server error', () => answer(login(), json({}, 500))],
      ['a body that is not rows', () => answer(login(), json({ data: [] }))],
      [
        'a row with a fractional count',
        () => answer(login(), metrics([{ x: '/', y: 1.5 }])),
      ],
      [
        'a network failure',
        () => fetchMock.mockRejectedValue(new TypeError('fetch failed')),
      ],
      [
        'a timeout',
        () =>
          fetchMock.mockRejectedValue(
            new DOMException('timed out', 'TimeoutError'),
          ),
      ],
    ])('%s', async (_label, arrange) => {
      arrange();
      const { readUmamiMetric } = await load();
      expect(await readUmamiMetric('pages', 30, NOW)).toEqual({
        status: 'unavailable',
      });
    });

    it('logs the reason without the password', async () => {
      answer(login(), json({}, 503));
      const { readUmamiMetric } = await load();
      await readUmamiMetric('pages', 30, NOW);
      const logged = vi.mocked(console.warn).mock.calls.flat().join(' ');
      expect(logged).toContain('503');
      expect(logged).not.toContain('p@ss word');
    });
  });

  describe('the cache', () => {
    beforeEach(() => configure());

    it('serves the same window from memory for five minutes', async () => {
      answer(login(), metrics([{ x: '/', y: 1 }]), metrics([{ x: '/', y: 2 }]));
      const { readUmamiMetric, CACHE_TTL_MS } = await load();

      await readUmamiMetric('pages', 30, NOW);
      const soon = new Date(NOW.getTime() + CACHE_TTL_MS - 1);
      expect(await readUmamiMetric('pages', 30, soon)).toEqual({
        status: 'ok',
        rows: [{ key: '/', count: 1 }],
      });
      expect(calls).toHaveLength(2);

      const later = new Date(NOW.getTime() + CACHE_TTL_MS);
      expect(await readUmamiMetric('pages', 30, later)).toEqual({
        status: 'ok',
        rows: [{ key: '/', count: 2 }],
      });
    });

    it('keeps windows and kinds apart', async () => {
      answer(login(), metrics([]), metrics([]), metrics([]));
      const { readUmamiMetric } = await load();
      await readUmamiMetric('pages', 30, NOW);
      await readUmamiMetric('pages', 7, NOW);
      await readUmamiMetric('referrers', 30, NOW);
      expect(calls).toHaveLength(4);
    });

    it('remembers a failure for a minute, then tries again', async () => {
      answer(login(), json({}, 500), metrics([]));
      const { readUmamiMetric, FAILURE_TTL_MS } = await load();
      await readUmamiMetric('pages', 30, NOW);

      const soon = new Date(NOW.getTime() + FAILURE_TTL_MS - 1);
      expect(await readUmamiMetric('pages', 30, soon)).toEqual({
        status: 'unavailable',
      });
      expect(calls).toHaveLength(2);

      const later = new Date(NOW.getTime() + FAILURE_TTL_MS);
      expect(await readUmamiMetric('pages', 30, later)).toEqual({
        status: 'ok',
        rows: [],
      });
    });

    it('keeps a failure to its own window', async () => {
      answer(login(), json({}, 500), metrics([]));
      const { readUmamiMetric } = await load();
      await readUmamiMetric('pages', 30, NOW);
      expect(await readUmamiMetric('pages', 7, NOW)).toEqual({
        status: 'ok',
        rows: [],
      });
    });
  });
});
