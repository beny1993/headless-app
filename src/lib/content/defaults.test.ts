// The defaults are both the seed and the fallback, so two things must hold: each
// default parses under its own key's schema (a fallback can never itself be
// invalid), and every default image is a committed file under public/ (a broken
// default would be a broken storefront on an empty table). Plus `resolveContent`'s
// three branches: missing → default silent, invalid → default + one warn, valid → parsed.
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONTENT_KEYS,
  CONTENT_SCHEMAS,
  imageKeySchema,
  type ContentKey,
} from './site-content';
import { DEFAULT_CONTENT, resolveContent } from './defaults';

/** Every image key that appears anywhere in the defaults. */
const defaultImageKeys: string[] = [];
for (const value of Object.values(DEFAULT_CONTENT)) {
  const v = value as Record<string, unknown>;
  if (v.image && typeof v.image === 'object') {
    defaultImageKeys.push((v.image as { key: string }).key);
  }
  if (Array.isArray(v.slots)) {
    for (const slot of v.slots as { image: string }[]) {
      defaultImageKeys.push(slot.image);
    }
  }
}

describe('DEFAULT_CONTENT', () => {
  it('has a default for every declared key', () => {
    expect(Object.keys(DEFAULT_CONTENT).sort()).toEqual(
      [...CONTENT_KEYS].sort(),
    );
  });

  it('every default parses under its own schema', () => {
    for (const key of CONTENT_KEYS) {
      const result = CONTENT_SCHEMAS[key].safeParse(DEFAULT_CONTENT[key]);
      expect(result.success, `${key}: ${JSON.stringify(result)}`).toBe(true);
    }
  });

  it('every default image key is a valid, slash-less key', () => {
    expect(defaultImageKeys.length).toBeGreaterThan(0);
    for (const key of defaultImageKeys) {
      expect(imageKeySchema.safeParse(key).success, key).toBe(true);
    }
  });

  it('points every default image at a file committed under public/', async () => {
    for (const key of new Set(defaultImageKeys)) {
      await expect(
        access(join(process.cwd(), 'public', key)),
        key,
      ).resolves.toBeUndefined();
    }
  });

  it('keeps the Luna wall tile and the About story caption editable independently', () => {
    // The identity bug the story exists to make fixable: the same photo is
    // «لونا» on Home and the «این اسموکی‌ه» story on About today. Both are
    // defaults now, so both are editable — this pins that they start as today.
    expect(DEFAULT_CONTENT['home.family'].slots[0]).toMatchObject({
      image: 'site/community-luna.jpg',
      name: 'لونا',
    });
    expect(DEFAULT_CONTENT['about.story']).toMatchObject({
      title: 'این اسموکی‌ه',
      image: {
        key: 'site/community-luna.jpg',
        alt: 'اسموکی، گربه‌ای سیاه‌وسفید با چشمان سبز',
      },
    });
  });
});

describe('resolveContent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the default for a missing row, without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveContent('about.cta', undefined)).toEqual(
      DEFAULT_CONTENT['about.cta'],
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns a stored valid value, stripped to the schema', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const resolved = resolveContent('about.cta', {
      headline: 'سلام',
      injected: '<script>',
    });
    expect(resolved).toEqual({ headline: 'سلام' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to the default and warns once for an invalid row', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A row hand-edited outside the app: an object with the wrong shape.
    expect(resolveContent('about.cta', { headline: '' })).toEqual(
      DEFAULT_CONTENT['about.cta'],
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('about.cta');
  });

  it('falls back and warns for a row carrying an out-of-shape image key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = {
      ...DEFAULT_CONTENT['about.story'],
      image: { key: 'http://evil/x.jpg', alt: 'x' },
    };
    expect(resolveContent('about.story', bad)).toEqual(
      DEFAULT_CONTENT['about.story'],
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('falls back for a null or non-object row', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const raw of [null, 'a string', 42, []] as unknown[]) {
      expect(resolveContent('home.philosophy', raw)).toEqual(
        DEFAULT_CONTENT['home.philosophy'],
      );
    }
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it('resolves every key’s default when the row is missing', () => {
    for (const key of CONTENT_KEYS as readonly ContentKey[]) {
      expect(resolveContent(key, undefined)).toEqual(DEFAULT_CONTENT[key]);
    }
  });
});
