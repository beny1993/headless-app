// The request helpers' contract: unwrap the success envelope, and on a non-2xx
// throw an `ApiRequestError` carrying the HTTP status and the envelope's
// `errors[]` (the per-field detail checkout maps to inputs) — while still being
// an `Error` for the call sites that only read `.message`. Custom headers reach
// the request. `fetch` is the only thing stubbed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, post, postData, postForm } from './api-client';

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

describe('postForm', () => {
  it('unwraps the success envelope to its data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(201, {
        status: 'success',
        data: { key: 'uploads/cat.jpg' },
      }),
    );

    await expect(
      postForm('/api/admin/content/images', new FormData()),
    ).resolves.toEqual({ key: 'uploads/cat.jpg' });
  });

  it('sets no Content-Type, so the browser writes the multipart boundary', async () => {
    // The whole reason both upload call sites hand-rolled a `fetch`: the JSON
    // helpers set `Content-Type: application/json` unconditionally, and a
    // multipart body sent under that header reaches Hono's `parseBody()` with
    // no boundary to split on — the file is simply not there.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(201, { status: 'success', data: null }));

    const form = new FormData();
    await postForm('/api/admin/content/images', form);

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(form);
    expect(init.headers ?? {}).not.toHaveProperty('Content-Type');
  });

  it('throws ApiRequestError carrying the status and the envelope errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(413, {
        status: 'error',
        message: 'حجم تصویر بیش از حد مجاز است.',
        errors: ['image: File is larger than the 2 MB ceiling'],
      }),
    );

    let caught: unknown;
    try {
      await postForm('/api/admin/content/images', new FormData());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    const error = caught as ApiRequestError;
    expect(error.status).toBe(413);
    expect(error.message).toBe('حجم تصویر بیش از حد مجاز است.');
    expect(error.errors).toEqual([
      'image: File is larger than the 2 MB ceiling',
    ]);
  });
});
