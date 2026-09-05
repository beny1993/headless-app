/**
 * Envelope-aware API client for the Hono routes under /api.
 *
 * Prefer the `getData`/`postData`/`patchData` variants — they unwrap the
 * `{ status: 'success', data }` envelope and throw `Error(message)` on the
 * error branch. Use the raw `get`/`post`/`patch` only when the caller must
 * inspect the envelope itself.
 */
import { unwrap, type ApiResponse } from '@/lib/hono/envelope';
import { getAppBaseUrl } from '@/lib/utils/env';

const DEFAULT_ERROR_MESSAGE =
  'Sorry for the inconvenience, please try again later';

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

type Query = Record<string, string | number | boolean | string[] | undefined>;

type Headers = Record<string, string>;

const buildUrl = (path: string, query?: Query): string => {
  const base =
    typeof window === 'undefined' ? getAppBaseUrl() : window.location.origin;
  const url = new URL(path, base);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          value.forEach((v) => url.searchParams.append(key, String(v)));
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    });
  }
  return url.toString();
};

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

async function request<T>(
  path: string,
  init: RequestInit & { query?: Query } = {},
): Promise<T> {
  const { query, ...rest } = init;
  const response = await fetch(buildUrl(path, query), {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...rest.headers,
    },
  });
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

/** Raw envelope readers — caller branches on `status` itself. */
export const get = <T>(path: string, query?: Query) =>
  request<ApiResponse<T>>(path, { method: 'GET', query });

export const post = <T>(path: string, body?: unknown, headers?: Headers) =>
  request<ApiResponse<T>>(path, withBody('POST', body, headers));

export const patch = <T>(path: string, body?: unknown) =>
  request<ApiResponse<T>>(path, withBody('PATCH', body));

export const put = <T>(path: string, body?: unknown) =>
  request<ApiResponse<T>>(path, withBody('PUT', body));

/**
 * DELETE returns the standard envelope with a 200, not a bodyless 204 — `request`
 * reads `response.json()` unconditionally, and a 204 would leave it parsing an
 * empty body. The authed `/me` delete routes answer `apiSuccess({ id })`.
 */
export const del = <T>(path: string) =>
  request<ApiResponse<T>>(path, withBody('DELETE'));

/**
 * Envelope-unwrapping variants — return `data`, throw `ApiRequestError` (an
 * `Error` subclass carrying `status` and the envelope's `errors[]`).
 */
export const getData = async <T>(path: string, query?: Query): Promise<T> =>
  unwrap(await get<T>(path, query));

export const postData = async <T>(
  path: string,
  body?: unknown,
  headers?: Headers,
): Promise<T> => unwrap(await post<T>(path, body, headers));

export const patchData = async <T>(path: string, body?: unknown): Promise<T> =>
  unwrap(await patch<T>(path, body));

export const putData = async <T>(path: string, body?: unknown): Promise<T> =>
  unwrap(await put<T>(path, body));

export const delData = async <T>(path: string): Promise<T> =>
  unwrap(await del<T>(path));
