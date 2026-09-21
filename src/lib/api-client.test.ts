// The request helpers' contract: unwrap the success envelope, and on a non-2xx
// throw an `ApiRequestError` carrying the HTTP status and the envelope's
// `errors[]` (the per-field detail checkout maps to inputs) — while still being
// an `Error` for the call sites that only read `.message`. Custom headers reach
// the request. `fetch` is the only thing stubbed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ApiRequestError,
  DEFAULT_ERROR_MESSAGE,
  del,
  get,
  post,
  postData,
  postForm,
} from './api-client';

const KEY = z.object({ key: z.string() });

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
      postForm('/api/admin/content/images', new FormData(), KEY),
    ).resolves.toEqual({ key: 'uploads/cat.jpg' });
  });

  it('sets no Content-Type, so the browser writes the multipart boundary', async () => {
    // The whole reason both upload call sites hand-rolled a `fetch`: the JSON
    // helpers set `Content-Type: application/json` unconditionally, and a
    // multipart body sent under that header reaches Hono's `parseBody()` with
    // no boundary to split on — the file is simply not there.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(201, {
        status: 'success',
        data: { key: 'uploads/a.jpg' },
      }),
    );

    const form = new FormData();
    await postForm('/api/admin/content/images', form, KEY);

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(form);
    // Asserted positively as well: `?? {}` alone would also pass the day
    // `request` stops sending a headers object at all, which would strip the
    // JSON header off every other caller and leave this test green.
    expect(init.headers).toBeDefined();
    expect(init.headers).not.toHaveProperty('Content-Type');
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
      await postForm('/api/admin/content/images', new FormData(), KEY);
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

  it('falls back to Persian when the refusal carried no sentence of its own', async () => {
    // A 413 or 502 from the CDN or the ingress, not from this app: an HTML
    // page, so `handleError` parses no `message`. The status is still a 4xx, so
    // `product-form`'s `reasonFrom` forwards whatever this says straight into
    // Persian admin copy — an English fallback would be read there as the
    // server's own explanation.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>413 Request Entity Too Large</html>', {
        status: 413,
        headers: { 'content-type': 'text/html' },
      }),
    );

    await expect(
      postForm('/api/admin/content/images', new FormData(), KEY),
    ).rejects.toThrow(DEFAULT_ERROR_MESSAGE);
    expect(DEFAULT_ERROR_MESSAGE).toMatch(/[\u0600-\u06FF]/);
  });

  it('refuses a 2xx whose body is not the shape the route promises', async () => {
    // An intermediary answering 200 with its own JSON. Before the schema, the
    // call site destructured `key` off `undefined` and the resulting English
    // `TypeError` went into the toast.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, { status: 'success', data: { notKey: 1 } }),
    );

    await expect(
      postForm('/api/admin/content/images', new FormData(), KEY),
    ).rejects.toThrow(DEFAULT_ERROR_MESSAGE);
  });

  it('keeps the server’s own sentence from a 2xx error envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, { status: 'error', message: 'تصویر پذیرفته نشد.' }),
    );

    await expect(
      postForm('/api/admin/content/images', new FormData(), KEY),
    ).rejects.toThrow('تصویر پذیرفته نشد.');
  });
});

describe('bodyless requests', () => {
  it.each([
    ['GET', () => get('/api/products')],
    ['DELETE', () => del('/api/me/pets/1')],
  ])('sends no Content-Type on a %s with no body', async (_method, call) => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(200, { status: 'success', data: null }));

    await call();

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect(init.headers).not.toHaveProperty('Content-Type');
  });
});
