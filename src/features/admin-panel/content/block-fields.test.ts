// The drift catcher: the editor's field map and the content schema must describe
// exactly the same set of leaves. If a schema field gains, loses or renames a
// leaf and the descriptors are not updated, this fails — so the editor can never
// silently stop editing a field or point a control at a path that no longer
// exists. Plus getPath/setPath behaviour, including immutability.
import { describe, expect, it } from 'vitest';
import { CONTENT_KEYS, type ContentKey } from '@/lib/content/site-content';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import { BLOCK_FIELDS, getPath, setPath } from './block-fields';

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

describe('BLOCK_FIELDS', () => {
  it('has a block descriptor for every content key', () => {
    expect(Object.keys(BLOCK_FIELDS).sort()).toEqual([...CONTENT_KEYS].sort());
  });

  it('describes exactly the leaves of each key’s default — no drift', () => {
    for (const key of CONTENT_KEYS as readonly ContentKey[]) {
      const descriptorPaths = BLOCK_FIELDS[key].fields.map((f) => f.path);
      const leaves = leafPaths(DEFAULT_CONTENT[key]);

      // No duplicate descriptors.
      expect(new Set(descriptorPaths).size, key).toBe(descriptorPaths.length);
      // Same set both ways: every descriptor is a real leaf, every leaf described.
      expect(new Set(descriptorPaths), key).toEqual(new Set(leaves));
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

  it('gives every target a non-empty string, and puts targets on the link labels', () => {
    for (const key of CONTENT_KEYS as readonly ContentKey[]) {
      for (const field of BLOCK_FIELDS[key].fields) {
        if (field.target !== undefined) {
          expect(
            field.target.length,
            `${key} ${field.path} target`,
          ).toBeGreaterThan(0);
        }
      }
    }

    // The label-with-a-fixed-target AC: the CTA / nav / footer-link / card / tab
    // labels each show a destination. Spot-check one of each kind — a label that
    // sits on a link but forgets its target would slip the AC otherwise.
    const targetOf = (key: ContentKey, path: string) =>
      BLOCK_FIELDS[key].fields.find((f) => f.path === path)?.target;

    expect(targetOf('home.hero', 'shopCta')).toBe('/shop');
    expect(targetOf('home.hero', 'aboutCta')).toBe('/about');
    expect(targetOf('home.guide', 'cta')).toBe('/shop?category=wet-food');
    expect(targetOf('home.philosophy', 'cta')).toBe('/about');
    expect(targetOf('about.cta', 'cta')).toBe('/shop');
    expect(targetOf('home.categories', 'cta')).toBe('/shop');
    expect(targetOf('home.moments', 'cta')).toBe('/shop');
    // A moment card's title carries its own deep-link destination.
    expect(targetOf('home.moments', 'cards.0.title')).toBe(
      '/shop?category=dry-food&pet=cat',
    );
    expect(targetOf('header', 'nav.0')).toBe('/');
    expect(targetOf('header', 'nav.1')).toBe('/shop');
    expect(targetOf('footer', 'columns.1.links.0')).toBe('/about');
    // A routine tab shows its category slugs.
    expect(targetOf('home.routine', 'slots.2.label')).toBe(
      'supplements, hygiene',
    );
  });

  it('every descriptor path resolves to a string in the default', () => {
    for (const key of CONTENT_KEYS as readonly ContentKey[]) {
      for (const field of BLOCK_FIELDS[key].fields) {
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

  it('round-trips with getPath', () => {
    const updated = setPath(
      DEFAULT_CONTENT['about.process'],
      'steps.2.desc',
      'توضیح جدید',
    );
    expect(getPath(updated, 'steps.2.desc')).toBe('توضیح جدید');
  });
});
