/**
 * Envelope-aware API client for the Hono routes under /api.
 *
 * The `*Data` helpers unwrap the `{ status: 'success', data }` envelope and
 * throw `ApiRequestError` on the error branch.
 */
import { z } from 'zod';
import { unwrap, type ApiResponse } from '@/lib/hono/envelope';

/**
 * What an admin or a shopper reads when the failure carried no sentence of its
 * own — a refusal from something that is not this app (a CDN 413 page, an
 * ingress 502) parses to no `message`, and the reply still has to be Persian.
 * Every screen in this app is `lang="fa"`, so this string is UI copy, not a
 * developer string; it is the wording `GENERIC_ERROR` already uses in the admin
 * forms.
 */
export const DEFAULT_ERROR_MESSAGE = 'خطای غیرمنتظره رخ داد. دوباره تلاش کن.';

/**
 * A non-2xx API response, thrown by the request helpers. Extends `Error` so the
 * many call sites that only read `.message` keep working, but also carries the
 * HTTP `status` and the envelope's `errors[]` — the per-field detail a form needs
 * to map `path: message` strings back to its inputs (checkout's 422). `errors`
 * is validated to be a `string[]` before it is attached, so a malformed body can
 * never smuggle a non-string through.
 */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors?: string[],
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

type Headers = Record<string, string>;

async function handleError(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as {
    message?: unknown;
    errors?: unknown;
  } | null;
  const message =
    body && typeof body.message === 'string'
      ? body.message
      : DEFAULT_ERROR_MESSAGE;
  const errors =
    body &&
    Array.isArray(body.errors) &&
    body.errors.every((e): e is string => typeof e === 'string')
      ? body.errors
      : undefined;
  throw new ApiRequestError(response.status, message, errors);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(
    new URL(path, window.location.origin).toString(),
    {
      ...init,
      headers: {
        // Only a JSON body gets the JSON header. A `FormData` body writes its
        // own `multipart/form-data; boundary=…`, and declaring
        // `application/json` over it loses the boundary — the server then parses
        // no parts at all, so the upload arrives fileless rather than failing
        // loudly. Both admin image uploads hand-rolled a bare `fetch` to dodge
        // exactly that. A bodyless `GET`/`DELETE` gets no header either: it has
        // no content to describe, and a `Content-Type` on a GET is a documented
        // trigger for WAF rules and a reason for a CDN to skip the cache.
        ...(init.body !== undefined && !(init.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...init.headers,
      },
    },
  );
  if (!response.ok) await handleError(response);
  return response.json() as Promise<T>;
}

const withBody = (
  method: string,
  body?: unknown,
  headers?: Headers,
): RequestInit & { headers?: Headers } => ({
  method,
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  ...(headers ? { headers } : {}),
});

const post = <T>(path: string, body?: unknown, headers?: Headers) =>
  request<ApiResponse<T>>(path, withBody('POST', body, headers));

const patch = <T>(path: string, body?: unknown) =>
  request<ApiResponse<T>>(path, withBody('PATCH', body));

const put = <T>(path: string, body?: unknown) =>
  request<ApiResponse<T>>(path, withBody('PUT', body));

/**
 * DELETE returns the standard envelope with a 200, not a bodyless 204 — `request`
 * reads `response.json()` unconditionally, and a 204 would leave it parsing an
 * empty body. The authed `/me` delete routes answer `apiSuccess({ id })`.
 */
const del = <T>(path: string) =>
  request<ApiResponse<T>>(path, withBody('DELETE'));

/**
 * Envelope-unwrapping variants — return `data`, throw `ApiRequestError` (an
 * `Error` subclass carrying `status` and the envelope's `errors[]`).
 */
export const postData = async <T>(
  path: string,
  body?: unknown,
  headers?: Headers,
): Promise<T> => unwrap(await post<T>(path, body, headers));

/**
 * Multipart POST — the same envelope unwrap and the same `ApiRequestError` as
 * `postData`, for the admin image uploads. No JSON body, so no `Content-Type`
 * (see `request`); the session cookie rides on the same-origin request.
 *
 * `schema` is not decoration: both call sites read one field straight off the
 * result, and a 2xx that is not the shape the route promises would otherwise
 * reach them as `undefined` and throw a destructuring `TypeError` whose English
 * text lands in a Persian toast.
 */
export const postForm = async <T>(
  path: string,
  form: FormData,
  schema: z.ZodType<T>,
): Promise<T> => {
  const envelope = await request<ApiResponse<T>>(path, {
    method: 'POST',
    body: form,
  });
  try {
    return schema.parse(unwrap(envelope));
  } catch (error) {
    // The server's own error envelope carries a sentence written for the
    // admin, in Persian — keep it. What is left is developer text: `unwrap`'s
    // malformed-envelope assertion and Zod's issue strings, both English and
    // neither fit for a toast.
    if (envelope?.status === 'error') throw error;
    throw new Error(DEFAULT_ERROR_MESSAGE);
  }
};

export const patchData = async <T>(path: string, body?: unknown): Promise<T> =>
  unwrap(await patch<T>(path, body));

export const putData = async <T>(path: string, body?: unknown): Promise<T> =>
  unwrap(await put<T>(path, body));

export const delData = async <T>(path: string): Promise<T> =>
  unwrap(await del<T>(path));
