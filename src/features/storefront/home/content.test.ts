// No database needed: these check the home page's editorial content itself.
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_IMAGES,
  COMMUNITY_PETS,
  HERO_IMAGE,
  LIFE_MOMENTS,
  ROUTINE,
  STORY_IMAGE,
} from '@/features/storefront/home/content';
import { SEED_CATEGORIES } from '@/db/seed/catalog-data';
import { PET_TYPES } from '@/db/schema/catalog';

const SEED_SLUGS = new Set<string>(SEED_CATEGORIES.map((row) => row.slug));

const everyImage = [
  HERO_IMAGE,
  STORY_IMAGE,
  ...Object.values(CATEGORY_IMAGES),
  ...LIFE_MOMENTS.map((moment) => moment.image),
  ...COMMUNITY_PETS.map((pet) => pet.image),
];

describe('home content images', () => {
  it('serves every photo from this repo — no external hotlink anywhere', () => {
    // The blocker of the design review: Unsplash URLs are slow or unreachable
    // from Iranian IPs. A relative path is the whole guarantee.
    for (const image of everyImage) {
      expect(image).not.toMatch(/^(https?:)?\/\//);
      expect(image).toMatch(/^\//);
    }
  });

  it('points every photo at a file that is actually committed', async () => {
    // A typo would only ever surface as a broken image in the browser.
    for (const image of new Set(everyImage)) {
      await expect(
        access(join(process.cwd(), 'public', image)),
      ).resolves.toBeUndefined();
    }
  });

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

describe('category tiles', () => {
  it('has a photo for every category the catalog ships with', () => {
    for (const category of SEED_CATEGORIES) {
      expect(CATEGORY_IMAGES[category.slug]).toBeDefined();
    }
  });

  it('names no category the catalog does not have', () => {
    for (const slug of Object.keys(CATEGORY_IMAGES)) {
      expect(SEED_SLUGS).toContain(slug);
    }
  });
});

describe('life moments', () => {
  it('deep-links every card into a real category and pet type', () => {
    const pets = new Set<string>(Object.values(PET_TYPES));

    expect(LIFE_MOMENTS.length).toBeGreaterThan(0);
    for (const moment of LIFE_MOMENTS) {
      expect(SEED_SLUGS).toContain(moment.filters.category);
      expect(pets).toContain(moment.filters.pet);
    }
  });
});

describe('routine', () => {
  it('covers the four times of day the design shows', () => {
    expect(ROUTINE.map((slot) => slot.label)).toEqual([
      'صبح',
      'ظهر',
      'عصر',
      'شب',
    ]);
  });

  it('names only categories that exist', () => {
    // The prototype listed invented product names here linking to a product
    // that was not the one named. Every tile is a real category instead.
    for (const slot of ROUTINE) {
      expect(slot.categories.length).toBeGreaterThan(0);
      for (const slug of slot.categories) expect(SEED_SLUGS).toContain(slug);
    }
  });
});

describe('community grid', () => {
  it('gives every photo a caption that is always readable', () => {
    // Hover-only captions were a design-review finding — unusable on touch.
    // The caption is rendered unconditionally, so it must always have content.
    expect(COMMUNITY_PETS.length).toBeGreaterThan(0);
    for (const pet of COMMUNITY_PETS) {
      expect(pet.name.trim()).not.toBe('');
      expect(pet.owner.trim()).not.toBe('');
      expect(pet.quote.trim()).not.toBe('');
    }
  });
});
