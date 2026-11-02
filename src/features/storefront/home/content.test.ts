// No database needed: these check the home page's code-side data and its parity
// with the editable content it zips against.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { knownShelfPath } from '@/features/storefront/home/content';
import { shopPath } from '@/lib/constant/paths';
import {
  FOOTER_TARGETS,
  NAV_TARGETS,
} from '@/features/storefront/layout/nav-links';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import { CONTENT_SCHEMAS } from '@/lib/content/site-content';
import { SEED_CATEGORIES } from '@/db/seed/catalog-data';

const SEED_SLUGS = new Set<string>(SEED_CATEGORIES.map((row) => row.slug));

// The hero/guide/about photos all moved into the content defaults
// (`src/lib/content/defaults.ts`) as slash-less storage keys — covered by
// `defaults.test.ts` — and the category photos into the catalog
// (`categories.image_key`), whose demo keys `catalog-data.test.ts` checks.

describe('bundled photos', () => {
  it('credits every bundled photo in public/ATTRIBUTIONS.md', async () => {
    // These are licensed stock photos. The licence is only honoured if the
    // record exists, and the record is exactly the thing that gets forgotten
    // when someone drops a new .jpg into public/ — so the check is on the
    // directory.
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

describe('knownShelfPath', () => {
  const slugs = ['kitchen', 'mugs'];

  it('keeps a category the catalogue has', () => {
    expect(knownShelfPath({ category: 'kitchen' }, slugs)).toBe(
      shopPath({ category: 'kitchen' }),
    );
    expect(knownShelfPath({ category: 'mugs' }, slugs)).toBe(
      shopPath({ category: 'mugs' }),
    );
  });

  it('drops a category the catalogue lacks for the whole shop, as a deleted saved category does', () => {
    expect(knownShelfPath({ category: 'garden' }, slugs)).toBe(shopPath());
    expect(knownShelfPath({ category: 'kitchen' }, [])).toBe(shopPath());
  });

  it('leaves a link that names no category as it is', () => {
    expect(knownShelfPath({}, slugs)).toBe(shopPath());
  });
});

describe('the built-in shelf links', () => {
  it('name a category the demo catalogue seeds', () => {
    // The featured story's button: `featured-story.tsx` and its editor preview
    // in `block-fields.ts` both point at it.
    expect(SEED_SLUGS).toContain('home-decor');
  });
});

// The label-with-fixed-target mechanism: a block stores link labels in a tuple,
// code keeps a same-length tuple of the destinations, and the component zips them
// by index. If the two lengths ever diverge, label i and target i stop lining up
// and a label silently renders on the wrong link — the misroute the whole rule
// exists to prevent. This is the parity half of the guard (the render half is the
// nav/footer integration tests).
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
