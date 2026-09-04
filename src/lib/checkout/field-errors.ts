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
