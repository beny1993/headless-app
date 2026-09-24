// Turns the API error envelope's `errors: ['path: message']` list into per-field
// messages the checkout form maps back to its inputs, plus a bucket of anything
// that has no field to attach to (shown in a top-level alert). One client-safe
// module — no drizzle / `pg` / `@hono/zod-openapi` — so the form can import it.
//
// The server builds each entry as `${field}: ${message}` (createOrder's 422) or
// `${path}: ${message}` (a zod 400 via `formatZodIssues`). The split is on the
// FIRST `': '` only: a Persian message legitimately contains `': '`
// («موجودی: کافی نیست»), so splitting on the last — or on every — occurrence
// would truncate it. And an entry is treated as a field error only when the part
// before that first `': '` looks like a field path (ASCII word chars and dots,
// no spaces); a bare Persian sentence that happens to contain `': '` is NOT a
// path, so it falls through to `unmapped` rather than being mis-keyed.

import { z } from 'zod';
import { ApiRequestError, DEFAULT_ERROR_MESSAGE } from '@/lib/api-client';

/** A dotted field path: `items.0`, `address.provinceId`, `paymentMethod`. */
const FIELD_PATH = /^[A-Za-z0-9_.]+$/;

const SEPARATOR = ': ';

export type FieldErrors = {
  /** `path -> message`, first occurrence of a path winning. */
  fields: Record<string, string>;
  /** Entries with no field path — rendered in a top-level alert. */
  unmapped: string[];
};

/**
 * Splits envelope `errors` into `{ fields, unmapped }`. Never throws; an
 * `undefined`/empty list yields empty buckets.
 */
export function parseFieldErrors(errors: string[] | undefined): FieldErrors {
  const fields: Record<string, string> = {};
  const unmapped: string[] = [];

  for (const entry of errors ?? []) {
    const index = entry.indexOf(SEPARATOR);
    if (index > 0) {
      const path = entry.slice(0, index);
      const message = entry.slice(index + SEPARATOR.length);
      if (FIELD_PATH.test(path) && message.length > 0) {
        // First path wins: a later duplicate must not overwrite the message the
        // field already showed.
        if (!(path in fields)) fields[path] = message;
        continue;
      }
    }
    unmapped.push(entry);
  }

  return { fields, unmapped };
}

/**
 * The server's sentence for a refusal, when it sent one written for a person.
 *
 * `message` only, and only on a 4xx. A 5xx `message` is the literal
 * `Internal server error`, and anything that is not an `ApiRequestError` — a
 * browser's `TypeError: Failed to fetch`, a thrown bug — carries English
 * developer text. Neither belongs in Persian UI copy, so both are `undefined`
 * and the caller shows its own fallback.
 */
export const reasonFrom = (error: unknown): string | undefined =>
  error instanceof ApiRequestError && error.status >= 400 && error.status < 500
    ? error.message
    : undefined;

/** The statuses whose envelope carries `path: message` errors for a form. */
const FIELD_ERROR_STATUSES = new Set([400, 409, 422]);

/**
 * A failed form request, split into what its fields show and the one sentence
 * none of them can (`undefined` when the fields say it all). A 400/409/422 is
 * mapped onto fields; its unmapped entries, or its own `message` when nothing
 * mapped, become the sentence. Any other failure is `reasonFrom`'s, or
 * `fallback`.
 */
export function requestFieldErrors(
  error: unknown,
  fallback: string = DEFAULT_ERROR_MESSAGE,
): { fields: Record<string, string>; message?: string } {
  if (
    error instanceof ApiRequestError &&
    FIELD_ERROR_STATUSES.has(error.status)
  ) {
    const { fields, unmapped } = parseFieldErrors(error.errors);
    const message =
      unmapped.length > 0
        ? unmapped.join(' ')
        : Object.keys(fields).length === 0
          ? error.message
          : undefined;
    return { fields, message };
  }
  return { fields: {}, message: reasonFrom(error) ?? fallback };
}

/**
 * A client-side `safeParse` failure as `{ field: message }` — the first
 * message per top-level key, the shape the server's field errors take too.
 */
export const zodFieldErrors = (error: z.ZodError): Record<string, string> =>
  Object.fromEntries(
    Object.entries(
      // An untyped `ZodError` flattens to `{}`; its keys are field names.
      z.flattenError(error).fieldErrors as Record<string, string[] | undefined>,
    ).flatMap(([field, messages]) =>
      messages?.[0] ? [[field, messages[0]]] : [],
    ),
  );
