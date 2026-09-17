import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock at the module edge — the DAO — so the handler's own logic runs for real.
// `@/db` is mocked too because importing the DAO pulls in the db module, which
// asserts APP_CONFIG_DATABASE_URL at import time.
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/db/dao/HealthDao', () => ({
  HealthDao: { ping: vi.fn() },
}));

const { HealthDao } = await import('@/db/dao/HealthDao');
const { readinessHandler, NOT_READY_MESSAGE } = await import('./readiness');

const ping = vi.mocked(HealthDao.ping);

/** Minimal Hono-ish context: `c.json(body, status)` is all the handler uses. */
const makeContext = () => {
  const json = vi.fn((body: unknown, status: number) => ({ body, status }));
  return { json } as never;
};

const invoke = async () => {
  const c = makeContext();
  // The handler's return value is whatever our `c.json` produced.
  return (await readinessHandler(c, undefined as never)) as unknown as {
    body: { status: string; data?: unknown; message?: string };
    status: number;
  };
};

describe('readinessHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with the success envelope when the database answers', async () => {
    ping.mockResolvedValueOnce(undefined);

    const res = await invoke();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'success',
      data: { status: 'ready', database: 'up' },
    });
  });

  it('actually probes the database rather than answering statically', async () => {
    ping.mockResolvedValueOnce(undefined);

    await invoke();

    // This is the whole point of the endpoint: /health does NOT do this.
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('returns 503 with the error envelope when the database is unreachable', async () => {
    ping.mockRejectedValueOnce(new Error('getaddrinfo EAI_AGAIN db-host'));

    const res = await invoke();

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', message: NOT_READY_MESSAGE });
  });

  it('returns 503 when the schema is missing, not just when the socket is down', async () => {
    // A reachable-but-unmigrated database: a fresh environment whose migrations
    // have not run. `select 1` would pass here.
    ping.mockRejectedValueOnce(
      new Error('relation "categories" does not exist'),
    );

    const res = await invoke();

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
  });

  it('does not leak the driver error to the client', async () => {
    ping.mockRejectedValueOnce(
      new Error('password authentication failed for user "smokey"'),
    );

    const res = await invoke();

    expect(JSON.stringify(res.body)).not.toContain('password');
    expect(JSON.stringify(res.body)).not.toContain('smokey');
  });
});
