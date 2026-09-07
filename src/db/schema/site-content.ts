// Storefront editorial content — one row per editable block (the hero, the guide,
// the About sections, …), keyed by the block key. The *structure* stays in code
// (see `src/lib/content/site-content.ts`); only the *values* live here.
//
// One table, not one-per-block: the blocks share no columns and are always read
// and written whole, so a single `key → value jsonb` row is the shape every
// caller wants. `value` is validated by zod on both write and read — drizzle
// types a `jsonb` column as `unknown`, and the DAO is the boundary that turns it
// into a typed, schema-checked block value (or a default when a row is invalid).
//
// No `CHECK` on `key`: a SQL copy of the key enum would be a second, driftable
// source of truth. The DAO only ever writes keys from the zod enum, and a stray
// row with an unknown key is simply never read (the pages ask for known keys).
//
// House rule, as everywhere: every timestamp is `timestamptz`.
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const siteContent = pgTable('site_content', {
  /** The block key, e.g. `home.hero` — the PK, one row per block. */
  key: text('key').primaryKey(),
  /** The block's value object; zod validates its shape on read and on write. */
  value: jsonb('value').notNull(),
  /**
   * Advanced on every write. `$onUpdate` fires inside `onConflictDoUpdate` too
   * (drizzle's `buildUpdateSet` includes `$onUpdate` columns), so the DAO's
   * upsert bumps this without naming it in the `set`.
   */
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export type SiteContentRow = typeof siteContent.$inferSelect;
export type NewSiteContentRow = typeof siteContent.$inferInsert;
