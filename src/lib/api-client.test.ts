// The request helpers' contract: unwrap the success envelope, and on a non-2xx
// throw an `ApiRequestError` carrying the HTTP status and the envelope's
// `errors[]` (the per-field detail checkout maps to inputs) — while still being
// an `Error` for the call sites that only read `.message`. Custom headers reach
// the request. `fetch` is the only thing stubbed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, post, postData } from './api-client';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => vi.restoreAllMocks());

describe('postData', () => {
  it('unwraps the success envelope to its data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, { status: 'success', data: { orderId: 'o1' } }),
    );

    await expect(postData('/api/checkout', { items: [] })).resolves.toEqual({
      orderId: 'o1',
    });
  });

  it('throws ApiRequestError with the status and envelope errors on a 422', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(422, {
        status: 'error',
        message: 'ورودی نامعتبر',
        errors: ['address.provinceId: استان نامعتبر است'],
      }),
    );

    let caught: unknown;
    try {
      await postData('/api/checkout');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect(caught).toBeInstanceOf(Error); // still catchable as a plain Error
    const error = caught as ApiRequestError;
    expect(error.status).toBe(422);
    expect(error.message).toBe('ورودی نامعتبر');
    expect(error.errors).toEqual(['address.provinceId: استان نامعتبر است']);
  });

  it('omits errors when the body carries none', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(401, { status: 'error', message: 'باید وارد شوی' }),
    );

    let caught: unknown;
    try {
      await postData('/api/checkout');
    } catch (error) {
      caught = error;
    }
    const error = caught as ApiRequestError;
    expect(error.status).toBe(401);
    expect(error.errors).toBeUndefined();
  });
});

describe('post headers', () => {
  it('sends the supplied headers on the request', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(200, { status: 'success', data: null }));

    await post('/api/checkout', { items: [] }, { 'Idempotency-Key': 'key-1' });

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('key-1');
    // The default content-type is still merged in.
    expect(headers['Content-Type']).toBe('application/json');
  });
});
