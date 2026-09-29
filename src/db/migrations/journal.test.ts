// Pins the migration journal's order. drizzle's runtime migrator (run by
// scripts/migrate.mjs on every container start) applies an entry only when its
// `when` is newer than the last migration the database already has, and skips
// anything else without a word. An entry renumbered or merged with an older
// `when` would never reach production, and the first query that needs it would
// fail there instead.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const journal = z
  .object({
    entries: z.array(
      z.object({ idx: z.number(), when: z.number(), tag: z.string() }),
    ),
  })
  .parse(
    JSON.parse(
      readFileSync(
        join(process.cwd(), 'src/db/migrations/meta/_journal.json'),
        'utf8',
      ),
    ),
  );

describe('the migration journal', () => {
  it('numbers every entry by its position, tag included', () => {
    journal.entries.forEach((entry, position) => {
      expect(entry.idx, entry.tag).toBe(position);
      expect(entry.tag).toMatch(
        new RegExp(`^${String(position).padStart(4, '0')}_`),
      );
    });
  });

  it('dates every entry after the one before it', () => {
    journal.entries.slice(1).forEach((entry, position) => {
      expect(entry.when, entry.tag).toBeGreaterThan(
        journal.entries[position].when,
      );
    });
  });
});
