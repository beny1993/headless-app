// The drift catcher: the editor's field map and the content schema must describe
// exactly the same fields. Text and image fields are checked against the leaves of
// each key's default; destinations — which no default carries — against the
// schema itself, so a link field added to a schema without a picker fails here
// too. Plus getPath/setPath behaviour, including immutability.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { linkSchema } from '@/lib/content/link';
import {
  CONTENT_KEYS,
  CONTENT_SCHEMAS,
  type ContentKey,
} from '@/lib/content/site-content';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import {
  BLOCK_FIELDS,
  getPath,
  setPath,
  type FieldDescriptor,
} from './block-fields';

/** Every dotted leaf path of a value (a leaf is a string; images/tuples recurse). */
function leafPaths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) =>
      leafPaths(v, prefix ? `${prefix}.${i}` : String(i)),
    );
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) =>
      leafPaths(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [];
}

/**
 * Every dotted path where a schema can store a destination: a link, or a routine
 * tab's `categoryIds`. Read from the schema itself — the defaults carry none — and
 * a destination list (`navLinks`, `linkTargets`) holds up to its `.max()`.
 * `_zod.bag.maximum` is zod's internal check metadata: a zod upgrade that moves it
 * breaks this test, not the app.
 */
function destinationPaths(schema: z.ZodType, prefix = ''): string[] {
  const at = (segment: string | number) =>
    prefix ? `${prefix}.${segment}` : String(segment);
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return destinationPaths(schema.unwrap() as z.ZodType, prefix);
  }
  if (schema === linkSchema) return [prefix];
  if (schema instanceof z.ZodObject) {
    return Object.entries(schema.shape).flatMap(([key, child]) =>
      key === 'categoryIds'
        ? [at(key)]
        : destinationPaths(child as z.ZodType, at(key)),
    );
  }
  if (schema instanceof z.ZodTuple) {
    return schema.def.items.flatMap((item, i) =>
      destinationPaths(item as z.ZodType, at(i)),
    );
  }
  if (schema instanceof z.ZodArray) {
    const { maximum = 0 } = schema._zod.bag as { maximum?: number };
    return Array.from({ length: maximum }, (_, i) =>
      destinationPaths(schema.element as z.ZodType, at(i)),
    ).flat();
  }
  return [];
}

const isPicker = (field: FieldDescriptor) =>
  field.kind === 'link' || field.kind === 'categories';

describe('BLOCK_FIELDS', () => {
  it('has a block descriptor for every content key', () => {
    expect(Object.keys(BLOCK_FIELDS).sort()).toEqual([...CONTENT_KEYS].sort());
  });

  it('describes exactly the text and image leaves of each key’s default — no drift', () => {
    for (const key of CONTENT_KEYS as readonly ContentKey[]) {
      const descriptorPaths = BLOCK_FIELDS[key].fields
        .filter((field) => !isPicker(field))
        .map((f) => f.path);
      const leaves = leafPaths(DEFAULT_CONTENT[key]);

      // No duplicate descriptors.
      expect(new Set(descriptorPaths).size, key).toBe(descriptorPaths.length);
      // Same set both ways: every descriptor is a real leaf, every leaf described.
      expect(new Set(descriptorPaths), key).toEqual(new Set(leaves));
    }
  });

  it('describes exactly the destinations each key’s schema can store — no drift', () => {
    for (const key of CONTENT_KEYS as readonly ContentKey[]) {
      const pickers = BLOCK_FIELDS[key].fields.filter(isPicker);
      const paths = pickers.map((field) => field.path);

      expect(new Set(paths).size, key).toBe(paths.length);
      expect(new Set(paths), key).toEqual(
        new Set(destinationPaths(CONTENT_SCHEMAS[key] as z.ZodType)),
      );
      for (const field of pickers) {
        expect(field.kind, `${key} ${field.path}`).toBe(
          field.path.endsWith('categoryIds') ? 'categories' : 'link',
        );
      }
    }
  });

  it('offers a picker for each of the 21 links and the 4 routine tabs', () => {
    const fields = CONTENT_KEYS.flatMap((key) => BLOCK_FIELDS[key].fields);
    expect(fields.filter((field) => field.kind === 'link')).toHaveLength(21);
    expect(fields.filter((field) => field.kind === 'categories')).toHaveLength(
      4,
    );
  });

  it('saves a destination at every picker path (setPath, then the schema)', () => {
    const link = { type: 'page', page: 'about' };
    const categoryIds = ['5f0c6a8e-3b1d-4c2a-9e7f-1a2b3c4d5e6f'];
    for (const key of CONTENT_KEYS as readonly ContentKey[]) {
      for (const field of BLOCK_FIELDS[key].fields.filter(isPicker)) {
        const sample = field.kind === 'link' ? link : categoryIds;
        const parsed = CONTENT_SCHEMAS[key].safeParse(
          setPath(DEFAULT_CONTENT[key], field.path, sample),
        );
        expect(parsed.success, `${key} ${field.path}`).toBe(true);
        expect(
          getPath(parsed.data, field.path),
          `${key} ${field.path}`,
        ).toEqual(sample);
      }
    }
  });

  it('marks exactly the image-key leaves as kind "image"', () => {
    for (const key of CONTENT_KEYS as readonly ContentKey[]) {
      for (const field of BLOCK_FIELDS[key].fields) {
        // The `{ key, alt }` images (hero/guide/about) plus the bare-key family
        // slots and moment cards — nothing else renders an ImagePicker.
        const isImageKey =
          field.path === 'image.key' ||
          /^(slots|cards)\.\d+\.image$/.test(field.path);
        expect(field.kind === 'image', `${key} ${field.path}`).toBe(isImageKey);
      }
    }
  });

  it('gives every picker the code destination it shows while nothing is saved', () => {
    for (const key of CONTENT_KEYS as readonly ContentKey[]) {
      for (const field of BLOCK_FIELDS[key].fields) {
        if (isPicker(field)) {
          expect(
            field.fallback?.length,
            `${key} ${field.path}`,
          ).toBeGreaterThan(0);
        } else {
          expect(field.fallback, `${key} ${field.path}`).toBeUndefined();
        }
      }
    }

    // One of each kind: a picker whose fallback drifted from the storefront's
    // would preview a destination the page does not use.
    const fallbackOf = (key: ContentKey, path: string) =>
      BLOCK_FIELDS[key].fields.find((f) => f.path === path)?.fallback;

    expect(fallbackOf('home.hero', 'shopCtaLink')).toBe('/shop');
    expect(fallbackOf('home.hero', 'aboutCtaLink')).toBe('/about');
    expect(fallbackOf('home.guide', 'ctaLink')).toBe('/shop?category=wet-food');
    expect(fallbackOf('home.philosophy', 'ctaLink')).toBe('/about');
    expect(fallbackOf('about.cta', 'ctaLink')).toBe('/shop');
    expect(fallbackOf('home.categories', 'ctaLink')).toBe('/shop');
    expect(fallbackOf('home.moments', 'ctaLink')).toBe('/shop');
    expect(fallbackOf('home.moments', 'cards.0.link')).toBe(
      '/shop?category=dry-food&pet=cat',
    );
    expect(fallbackOf('header', 'navLinks.0')).toBe('/');
    expect(fallbackOf('header', 'navLinks.1')).toBe('/shop');
    expect(fallbackOf('footer', 'columns.1.linkTargets.0')).toBe('/about');
    expect(fallbackOf('home.routine', 'slots.2.categoryIds')).toBe(
      'supplements, hygiene',
    );
  });

  it('every text and image descriptor path resolves to a string in the default', () => {
    for (const key of CONTENT_KEYS as readonly ContentKey[]) {
      for (const field of BLOCK_FIELDS[key].fields.filter(
        (f) => !isPicker(f),
      )) {
        expect(
          typeof getPath(DEFAULT_CONTENT[key], field.path),
          `${key} ${field.path}`,
        ).toBe('string');
      }
    }
  });
});

describe('getPath', () => {
  it('reads a nested and an array-indexed leaf', () => {
    expect(getPath(DEFAULT_CONTENT['about.cta'], 'headline')).toBe(
      DEFAULT_CONTENT['about.cta'].headline,
    );
    expect(getPath(DEFAULT_CONTENT['home.family'], 'slots.0.name')).toBe(
      'اسموکی',
    );
    expect(getPath(DEFAULT_CONTENT['about.story'], 'image.alt')).toBe(
      DEFAULT_CONTENT['about.story'].image.alt,
    );
  });

  it('returns undefined for a path that runs off the object', () => {
    expect(getPath({ a: 1 }, 'a.b.c')).toBeUndefined();
  });
});

describe('setPath', () => {
  it('sets a nested leaf and returns a new object, leaving the original intact', () => {
    const before = DEFAULT_CONTENT['about.story'];
    const after = setPath(before, 'title', 'عنوان تازه');

    expect(after.title).toBe('عنوان تازه');
    expect(before.title).not.toBe('عنوان تازه');
    expect(after).not.toBe(before);
  });

  it('sets an array-indexed leaf without mutating the source array', () => {
    const before = DEFAULT_CONTENT['home.family'];
    const after = setPath(before, 'slots.1.owner', 'رضا');

    expect(after.slots[1].owner).toBe('رضا');
    expect(before.slots[1].owner).not.toBe('رضا');
    // The tuple stays an array of the same length.
    expect(Array.isArray(after.slots)).toBe(true);
    expect(after.slots).toHaveLength(6);
    // Untouched siblings are carried over.
    expect(after.slots[0]).toEqual(before.slots[0]);
  });

  it('builds an array under a missing parent when the next segment is an index', () => {
    const link = { type: 'page', page: 'about' } as const;
    const after = setPath(DEFAULT_CONTENT.header, 'navLinks.1', link);

    // A destination list, not `{ "1": … }` — which the schema would refuse.
    expect(Array.isArray(after.navLinks)).toBe(true);
    expect(after.navLinks?.[1]).toEqual(link);
    // A missing parent under a named segment is still an object.
    expect(setPath({}, 'ctaLink.type', 'page')).toEqual({
      ctaLink: { type: 'page' },
    });
  });

  it('round-trips with getPath', () => {
    const updated = setPath(
      DEFAULT_CONTENT['about.process'],
      'steps.2.desc',
      'توضیح جدید',
    );
    expect(getPath(updated, 'steps.2.desc')).toBe('توضیح جدید');
  });
});
