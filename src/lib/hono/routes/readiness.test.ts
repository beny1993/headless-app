import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock at the module edge — the DAO — so the handler's own logic runs for real.
// `@/db` is mocked too because importing the DAO pulls in the db module, which
// asserts APP_CONFIG_DATABASE_URL at import time.
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/db/dao/HealthDao', () => ({
  HealthDao: { ping: vi.fn() },
}));
// Mocked at the module edge for the same reason: the handler's own logic runs
// for real, and the assert's own cases live in `src/lib/zarinpal/client.test.ts`.
// `assertReadyToServe`, not `assertMockGatewayAllowed`: the probe asks «may
// this container take traffic», which is the question that respects
// APP_CONFIG_ZARINPAL_ENABLED. The money path keeps the unconditional guard,
// and both are covered in `src/lib/zarinpal/client.test.ts`.
vi.mock('@/lib/zarinpal/client', () => ({
  assertReadyToServe: vi.fn(),
}));

const { HealthDao } = await import('@/db/dao/HealthDao');
const { assertReadyToServe } = await import('@/lib/zarinpal/client');
const { readinessHandler, NOT_READY_MESSAGE } = await import('./readiness');

const ping = vi.mocked(HealthDao.ping);
const assertGateway = vi.mocked(assertReadyToServe);

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
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // reset, not clear: a case whose gateway assert throws never consumes the
    // `ping` it queued, and `mockClear` leaves that queued value behind for
    // whichever case runs next. Reset empties the once-queues too.
    vi.resetAllMocks();
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => errorLog.mockRestore());

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

  // Readiness is where the mock-gateway refusal is hoisted to: Coolify's health
  // check points at `GET /api/ready` (docs/DEPLOY.md §6), so a 503 here is what
  // stops traffic reaching a production container that would settle orders as
  // paid for zero Toman. It fires whatever APP_CONFIG_ZARINPAL_ENABLED says.
  it('returns 503 when the mock gateway would serve a production build', async () => {
    assertGateway.mockImplementationOnce(() => {
      throw new Error('APP_CONFIG_ZARINPAL_ALLOW_MOCK is not set');
    });
    ping.mockResolvedValueOnce(undefined);

    const res = await invoke();

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', message: NOT_READY_MESSAGE });
  });

  it('checks the gateway before touching the database — no I/O to fail first', async () => {
    assertGateway.mockImplementationOnce(() => {
      throw new Error('APP_CONFIG_ZARINPAL_ALLOW_MOCK is not set');
    });

    await invoke();

    expect(ping).not.toHaveBeenCalled();
  });

  it('does not put the variable name in the client response', async () => {
    // The endpoint is public: the operator reads the name in the server log.
    assertGateway.mockImplementationOnce(() => {
      throw new Error('APP_CONFIG_ZARINPAL_ALLOW_MOCK is not set');
    });

    const res = await invoke();

    expect(JSON.stringify(res.body)).not.toContain('ZARINPAL');
  });

  it('checks the gateway on the happy path too, not only when it is broken', async () => {
    ping.mockResolvedValueOnce(undefined);

    const res = await invoke();

    expect(assertGateway).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  // Without this the probe is a silent 503: `getZarinpalProvider()` throws on an
  // unrecognized provider name BEFORE the mock refusal logs itself, so a typo in
  // APP_CONFIG_ZARINPAL_PROVIDER gave a container that 503s forever with nothing
  // to read, and Coolify rolled the deploy back blind.
  it('writes the reason to the server log so the operator can read it', async () => {
    assertGateway.mockImplementationOnce(() => {
      throw new Error(
        'APP_CONFIG_ZARINPAL_PROVIDER="zarinpall" has no driver.',
      );
    });

    await invoke();

    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog.mock.calls[0]!.map(String).join(' ')).toContain(
      'zarinpall',
    );
  });

  it('names a database failure in the log too, not only a gateway one', async () => {
    ping.mockRejectedValueOnce(new Error('getaddrinfo EAI_AGAIN db-host'));

    await invoke();

    expect(errorLog.mock.calls[0]!.map(String).join(' ')).toContain(
      'EAI_AGAIN',
    );
  });

  it('logs nothing when it is ready', async () => {
    ping.mockResolvedValueOnce(undefined);

    await invoke();

    expect(errorLog).not.toHaveBeenCalled();
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
