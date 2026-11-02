// Core is generic: no field, enum, route or copy belongs to one kind of shop.
// The tree started as a pet shop, and this pins that the pet vertical stays
// out of it — a stray `petType` or `/api/me/pets` is exactly what a later
// port from that shop would bring back without anyone noticing.
//
// Migration history is exempt: it records the tables it once created and the
// migration that dropped them, and rewriting it would break every database
// already migrated.
//
// Scope: English identifiers in source, tests and docs under src/, e2e/ and
// scripts/. Persian copy and public/ assets are reviewed by hand for now.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SCANNED = ['src', 'e2e', 'scripts'];
const SKIPPED_DIRS = new Set([
  path.join('src', 'db', 'migrations'),
  'node_modules',
]);
/** Files that name the retired vertical on purpose, each with its reason. */
const ALLOWED = new Set([
  // Proves a saved link written before the pet filter left still parses.
  path.join('src', 'lib', 'content', 'link.test.ts'),
  // This file: the pattern below names what it looks for.
  path.join('src', 'lib', 'no-vertical-identifiers.test.ts'),
]);
const TEXT = /\.(ts|tsx|js|mjs|json|md|css)$/;

const PET = /\bpets?\b|\bPET_|petTypes?|PetDao/i;

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(path.join(ROOT, dir), {
    withFileTypes: true,
  })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(relative)) yield* files(relative);
    } else if (TEXT.test(entry.name) && !ALLOWED.has(relative)) {
      yield relative;
    }
  }
}

describe('no vertical-specific identifiers in core', () => {
  it('names no pet anywhere outside migration history', () => {
    const hits = SCANNED.flatMap((dir) => [...files(dir)]).flatMap((file) =>
      readFileSync(path.join(ROOT, file), 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          PET.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [],
        ),
    );

    expect(hits).toEqual([]);
  });

  it('would catch one', () => {
    // The pattern, against the shapes the vertical took in this tree.
    for (const line of [
      "export const PET_TYPES = { CAT: 'cat' };",
      'petTypes: text().array()',
      "app.route('/me/pets', mePets);",
      'await PetDao.listByUser(id);',
      '// the pet filter',
    ]) {
      expect(PET.test(line), line).toBe(true);
    }
    // And not against the words that only contain the letters.
    for (const line of ['carpet', 'competitor', 'petrol', 'trumpet_case']) {
      expect(PET.test(line), line).toBe(false);
    }
  });
});
