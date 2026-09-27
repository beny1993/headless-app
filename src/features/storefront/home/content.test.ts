// No database needed: these check the home page's code-side data and its parity
// with the editable content it zips against.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LIFE_MOMENT_TARGETS,
  momentEmoji,
  ROUTINE_TARGETS,
} from '@/features/storefront/home/content';
import {
  FOOTER_TARGETS,
  NAV_TARGETS,
} from '@/features/storefront/layout/nav-links';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import { CONTENT_SCHEMAS } from '@/lib/content/site-content';
import { SEED_CATEGORIES } from '@/db/seed/catalog-data';
import { PET_TYPES } from '@/db/schema/catalog';

const SEED_SLUGS = new Set<string>(SEED_CATEGORIES.map((row) => row.slug));

// The moment/hero/guide/community/card photos all moved into the content defaults
// (`src/lib/content/defaults.ts`) as slash-less storage keys — covered by
// `defaults.test.ts` — and the category photos into the catalog
// (`categories.image_key`), whose demo keys `catalog-data.test.ts` checks.

describe('bundled photos', () => {
  it('credits every bundled photo in public/ATTRIBUTIONS.md', async () => {
    // These are licensed stock photos. The licence is only honoured if the
    // record exists, and the record is exactly the thing that gets forgotten
    // when someone drops a new .jpg into public/ — so the check is on the
    // directory, not on the list above.
    const attributions = await readFile(
      join(process.cwd(), 'public', 'ATTRIBUTIONS.md'),
      'utf8',
    );

    for (const dir of ['products', 'site']) {
      const files = await readdir(join(process.cwd(), 'public', dir));
      for (const file of files.filter((name) =>
        /\.(jpe?g|png|webp)$/i.test(name),
      )) {
        expect(attributions, `${dir}/${file} is not attributed`).toContain(
          file,
        );
      }
    }
  });
});

describe('life-moment targets', () => {
  it('deep-links every card into a real category and pet type', () => {
    const pets = new Set<string>(Object.values(PET_TYPES));

    expect(LIFE_MOMENT_TARGETS.length).toBeGreaterThan(0);
    for (const target of LIFE_MOMENT_TARGETS) {
      expect(SEED_SLUGS).toContain(target.filters.category);
      expect(pets).toContain(target.filters.pet);
    }
  });
});

describe('routine targets', () => {
  it('names only categories that exist', () => {
    // The prototype listed invented product names here linking to a product
    // that was not the one named. Every tile is a real category instead.
    for (const target of ROUTINE_TARGETS) {
      expect(target.categories.length).toBeGreaterThan(0);
      for (const slug of target.categories) expect(SEED_SLUGS).toContain(slug);
    }
  });
});

// The label-with-fixed-target mechanism: a block stores link labels in a tuple,
// code keeps a same-length tuple of the destinations, and the component zips them
// by index. If the two lengths ever diverge, label i and target i stop lining up
// and a label silently renders on the wrong link — the misroute the whole rule
// exists to prevent. This is the parity half of the guard (the render half is the
// nav/footer/home-card integration tests).
describe('label ↔ target parity', () => {
  it('has one nav target per header nav label', () => {
    expect(DEFAULT_CONTENT.header.nav).toHaveLength(NAV_TARGETS.length);
  });

  it('has one footer target column per footer link column, matching lengths', () => {
    const columns = DEFAULT_CONTENT.footer.columns;
    expect(columns).toHaveLength(FOOTER_TARGETS.length);
    columns.forEach((column, i) => {
      expect(column.links).toHaveLength(FOOTER_TARGETS[i].length);
    });
  });

  it('has one moment target per moment card', () => {
    expect(DEFAULT_CONTENT['home.moments'].cards).toHaveLength(
      LIFE_MOMENT_TARGETS.length,
    );
  });

  it('has one routine target per routine slot', () => {
    expect(DEFAULT_CONTENT['home.routine'].slots).toHaveLength(
      ROUTINE_TARGETS.length,
    );
  });
});

// The destination lists (`navLinks`, a footer column's `linkTargets`) zip with the
// same label tuples by index; unlike a label tuple they may be shorter, but never
// longer, or a destination would sit on no label at all.
describe('destination list ↔ label parity', () => {
  it('stores one header destination per nav label, and no more', () => {
    const fits = (n: number) =>
      CONTENT_SCHEMAS.header.safeParse({
        ...DEFAULT_CONTENT.header,
        navLinks: Array(n).fill(null),
      }).success;
    expect(fits(NAV_TARGETS.length)).toBe(true);
    expect(fits(NAV_TARGETS.length + 1)).toBe(false);
  });

  it('stores one footer destination per link label in each column, and no more', () => {
    FOOTER_TARGETS.forEach((targets, c) => {
      const fits = (n: number) => {
        const columns: unknown[] = [...DEFAULT_CONTENT.footer.columns];
        columns[c] = {
          ...DEFAULT_CONTENT.footer.columns[c],
          linkTargets: Array(n).fill(null),
        };
        return CONTENT_SCHEMAS.footer.safeParse({
          ...DEFAULT_CONTENT.footer,
          columns,
        }).success;
      };
      expect(fits(targets.length), `column ${c}`).toBe(true);
      expect(fits(targets.length + 1), `column ${c}`).toBe(false);
    });
  });
});

describe('momentEmoji', () => {
  it('keeps each card’s code emoji until a destination is saved', () => {
    LIFE_MOMENT_TARGETS.forEach((target, i) => {
      expect(momentEmoji(undefined, i)).toBe(target.emoji);
      expect(momentEmoji(null, i)).toBe(target.emoji);
    });
  });

  it('follows the pet of a saved destination, 🐾 when it names none', () => {
    // Card 2's code emoji is 🐶, so the saved cat is what shows.
    expect(momentEmoji({ type: 'shop', pet: 'cat' }, 2)).toBe('🐱');
    expect(momentEmoji({ type: 'shop', pet: 'dog' }, 0)).toBe('🐶');
    expect(momentEmoji({ type: 'shop' }, 0)).toBe('🐾');
    expect(momentEmoji({ type: 'page', page: 'about' }, 0)).toBe('🐾');
    expect(
      momentEmoji({ type: 'external', url: 'https://example.com/' }, 0),
    ).toBe('🐾');
  });
});
