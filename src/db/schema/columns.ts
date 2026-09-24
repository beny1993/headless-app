// The audit columns every table shares. Every timestamp is `timestamptz` — the
// repo stores instants in UTC and renders Jalali at the edge; a bare
// `timestamp()` drops the offset and is a bug. Not re-exported from `index.ts`:
// these are column builders, not tables.
import { timestamp } from 'drizzle-orm/pg-core';

export const createdAt = timestamp('created_at', { withTimezone: true })
  .defaultNow()
  .notNull();

export const updatedAt = timestamp('updated_at', { withTimezone: true })
  .defaultNow()
  .$onUpdate(() => /* @__PURE__ */ new Date())
  .notNull();
