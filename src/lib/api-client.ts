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

type Query = Record<string, string | number | boolean | string[] | undefined>;

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
  } | null;
  const message =
    body && typeof body.message === 'string'
      ? body.message
      : DEFAULT_ERROR_MESSAGE;
  throw new Error(message);
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

const withBody = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

/** Raw envelope readers — caller branches on `status` itself. */
export const get = <T>(path: string, query?: Query) =>
  request<ApiResponse<T>>(path, { method: 'GET', query });

export const post = <T>(path: string, body?: unknown) =>
  request<ApiResponse<T>>(path, withBody('POST', body));

export const patch = <T>(path: string, body?: unknown) =>
  request<ApiResponse<T>>(path, withBody('PATCH', body));

/** Envelope-unwrapping variants — return `data`, throw `Error(message)`. */
export const getData = async <T>(path: string, query?: Query): Promise<T> =>
  unwrap(await get<T>(path, query));

export const postData = async <T>(path: string, body?: unknown): Promise<T> =>
  unwrap(await post<T>(path, body));

export const patchData = async <T>(path: string, body?: unknown): Promise<T> =>
  unwrap(await patch<T>(path, body));
