// All Drizzle DB access to `site_content` goes through this DAO. It is the
// boundary that turns opaque `jsonb` rows into typed, schema-checked block values
// — parsing on READ (a missing or invalid row resolves to that key's default, so
// an empty table renders today's storefront and a row edited outside the app
// cannot break a page) and on WRITE (`set` parses before it stores, the last
// trust boundary the way a CHECK constraint is). Never write raw SQL.
import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { siteContent } from '@/db/schema/site-content';
import { resolveContent } from '@/lib/content/defaults';
import {
  CONTENT_SCHEMAS,
  type ContentKey,
  type ContentValue,
  type ContentValues,
} from '@/lib/content/site-content';

export class SiteContentDao {
  /**
   * Resolve every requested key to a valid block value. One `key IN (…)` read;
   * a key with no row, or a row that fails its schema, comes back as the default
   * (the latter with a server-side warning, via `resolveContent`). Only the keys
   * asked for are returned — a stray row with an unknown key is never surfaced.
   */
  static async getMany<K extends ContentKey>(
    keys: readonly K[],
  ): Promise<Pick<ContentValues, K>> {
    const rows = keys.length
      ? await db
          .select({ key: siteContent.key, value: siteContent.value })
          // `inArray` wants a mutable array; the callers pass a readonly tuple.
          .from(siteContent)
          .where(inArray(siteContent.key, [...keys]))
      : [];

    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    const out = {} as Pick<ContentValues, K>;
    for (const key of keys) {
      out[key] = resolveContent(key, byKey.get(key)) as ContentValues[K];
    }
    return out;
  }

  /**
   * Replace one block. The value is parsed against the key's schema first — a
   * bad value throws here and writes nothing (the route validates too, but psql
   * and a rogue caller bypass that). The upsert's `set: { value }` advances
   * `updated_at` via the column's `$onUpdate`. Returns the stored (parsed) value.
   */
  static async set<K extends ContentKey>(
    key: K,
    value: ContentValue<K>,
  ): Promise<ContentValue<K>> {
    const parsed = (CONTENT_SCHEMAS[key] as (typeof CONTENT_SCHEMAS)[K]).parse(
      value,
    ) as ContentValue<K>;

    await db
      .insert(siteContent)
      .values({ key, value: parsed })
      .onConflictDoUpdate({ target: siteContent.key, set: { value: parsed } });

    return parsed;
  }
}
