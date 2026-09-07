// The content contract's rules, proven directly — no DB, no browser. Every rule
// the security pass leans on lives here: image-key shapes accepted and rejected,
// the fixed-count tuples, the string ceilings, the NUL gate, whitespace-only,
// and that extra fields are stripped rather than stored.
import { describe, expect, it } from 'vitest';
import {
  CONTENT_KEYS,
  CONTENT_SCHEMAS,
  contentKeySchema,
  imageKeySchema,
} from './site-content';

const NUL = String.fromCharCode(0);

describe('contentKeySchema', () => {
  it('accepts every declared key and nothing else', () => {
    for (const key of CONTENT_KEYS) {
      expect(contentKeySchema.safeParse(key).success).toBe(true);
    }
    expect(contentKeySchema.safeParse('home.unknown').success).toBe(false);
    expect(contentKeySchema.safeParse('').success).toBe(false);
  });

  it('has a schema for exactly the declared keys', () => {
    expect(Object.keys(CONTENT_SCHEMAS).sort()).toEqual(
      [...CONTENT_KEYS].sort(),
    );
  });
});

describe('imageKeySchema', () => {
  it('accepts a bundled asset key', () => {
    for (const key of [
      'site/hero-home.jpg',
      'site/community-luna.jpg',
      'products/dog-dry-food.jpg',
      'products/cat-treats.png',
      'site/x.jpeg',
      'site/x.webp',
    ]) {
      expect(imageKeySchema.safeParse(key).success, key).toBe(true);
    }
  });

  it('accepts an uploads key with a uuid filename', () => {
    const key = 'uploads/123e4567-e89b-12d3-a456-426614174000.webp';
    expect(imageKeySchema.safeParse(key).success).toBe(true);
  });

  it('rejects every out-of-shape key', () => {
    for (const key of [
      'http://evil.example/x.jpg',
      'https://cdn.example/x.jpg',
      '//cdn.example/x.jpg',
      '/site/x.jpg', // leading slash
      'site/../x.jpg', // traversal
      '..',
      'uploads/x.jpg', // uploads key without a uuid filename
      'foo/x.jpg', // unknown prefix
      'site/x.gif', // unaccepted extension
      'site/x.php', // executable extension
      'site/X.JPG', // uppercase — the anchored class is lowercase
      'site/x', // no extension
      '', // empty
      `site/x${NUL}.jpg`, // embedded NUL
      `site/${'a'.repeat(200)}.jpg`, // over 200 chars
    ]) {
      expect(imageKeySchema.safeParse(key).success, key).toBe(false);
    }
  });
});

describe('CONTENT_SCHEMAS string fields', () => {
  const base = {
    eyebrow: 'a',
    headline: 'b',
    accent: 'c',
    body: 'd',
    image: { key: 'site/hero-home.jpg', alt: 'x' },
  };

  it('trims outer whitespace but keeps inner newlines', () => {
    const parsed = CONTENT_SCHEMAS['home.hero'].parse({
      ...base,
      headline: '  line one\nline two  ',
    });
    expect(parsed.headline).toBe('line one\nline two');
  });

  it('rejects a whitespace-only required field', () => {
    expect(
      CONTENT_SCHEMAS['home.hero'].safeParse({ ...base, eyebrow: '   ' })
        .success,
    ).toBe(false);
  });

  it('rejects a value over its max length', () => {
    expect(
      CONTENT_SCHEMAS['home.hero'].safeParse({
        ...base,
        eyebrow: 'a'.repeat(61),
      }).success,
    ).toBe(false);
    // 10k chars, well past every ceiling.
    expect(
      CONTENT_SCHEMAS['home.hero'].safeParse({
        ...base,
        body: 'a'.repeat(10_000),
      }).success,
    ).toBe(false);
  });

  it('rejects a NUL byte in a string field', () => {
    expect(
      CONTENT_SCHEMAS['home.hero'].safeParse({
        ...base,
        headline: `a${NUL}b`,
      }).success,
    ).toBe(false);
  });

  it('strips fields the schema does not declare rather than storing them', () => {
    const parsed = CONTENT_SCHEMAS['about.cta'].parse({
      headline: 'x',
      role: 'admin',
      injected: '<script>',
    }) as Record<string, unknown>;
    expect(parsed).toEqual({ headline: 'x' });
  });
});

describe('CONTENT_SCHEMAS visibility flag', () => {
  const base = {
    eyebrow: 'a',
    headline: 'b',
    accent: 'c',
    body: 'd',
    image: { key: 'site/hero-home.jpg', alt: 'x' },
  };

  it('is optional — omitted parses and leaves visible undefined (shown)', () => {
    expect(CONTENT_SCHEMAS['home.hero'].parse(base).visible).toBeUndefined();
    // Even the smallest block carries it.
    expect(CONTENT_SCHEMAS['about.cta'].parse({ headline: 'x' }).visible).toBe(
      undefined,
    );
  });

  it('accepts an explicit true or false', () => {
    expect(
      CONTENT_SCHEMAS['home.hero'].parse({ ...base, visible: false }).visible,
    ).toBe(false);
    expect(
      CONTENT_SCHEMAS['about.cta'].parse({ headline: 'x', visible: true })
        .visible,
    ).toBe(true);
  });

  it('rejects a non-boolean visible', () => {
    expect(
      CONTENT_SCHEMAS['home.hero'].safeParse({ ...base, visible: 'yes' })
        .success,
    ).toBe(false);
  });
});

describe('CONTENT_SCHEMAS fixed-count lists', () => {
  const slot = (name: string) => ({
    image: 'site/community-luna.jpg',
    name,
    owner: 'o',
    quote: 'q',
  });

  it('requires exactly five family slots', () => {
    const five = [slot('1'), slot('2'), slot('3'), slot('4'), slot('5')];
    expect(
      CONTENT_SCHEMAS['home.family'].safeParse({ slots: five }).success,
    ).toBe(true);
    expect(
      CONTENT_SCHEMAS['home.family'].safeParse({ slots: five.slice(0, 4) })
        .success,
    ).toBe(false);
    expect(
      CONTENT_SCHEMAS['home.family'].safeParse({
        slots: [...five, slot('6')],
      }).success,
    ).toBe(false);
  });

  it('validates the image key of every family slot', () => {
    const bad = [
      slot('1'),
      slot('2'),
      slot('3'),
      { ...slot('4'), image: 'http://evil/x.jpg' },
      slot('5'),
    ];
    expect(
      CONTENT_SCHEMAS['home.family'].safeParse({ slots: bad }).success,
    ).toBe(false);
  });

  it('requires exactly four process steps and four values', () => {
    const steps = [
      { step: 's1', desc: 'd1' },
      { step: 's2', desc: 'd2' },
      { step: 's3', desc: 'd3' },
      { step: 's4', desc: 'd4' },
    ];
    expect(
      CONTENT_SCHEMAS['about.process'].safeParse({ title: 't', steps }).success,
    ).toBe(true);
    expect(
      CONTENT_SCHEMAS['about.process'].safeParse({
        title: 't',
        steps: steps.slice(0, 3),
      }).success,
    ).toBe(false);
  });

  it('requires exactly three about-story paragraphs', () => {
    const image = { key: 'site/community-luna.jpg', alt: 'x' };
    expect(
      CONTENT_SCHEMAS['about.story'].safeParse({
        title: 't',
        paragraphs: ['a', 'b', 'c'],
        image,
      }).success,
    ).toBe(true);
    expect(
      CONTENT_SCHEMAS['about.story'].safeParse({
        title: 't',
        paragraphs: ['a', 'b'],
        image,
      }).success,
    ).toBe(false);
  });
});

describe('Persian content round-trips untouched', () => {
  it('keeps Persian characters, ZWNJ and guillemets intact', () => {
    const headline = 'ما هر چیزی را نمی‌فروشیم «واقعاً»';
    const parsed = CONTENT_SCHEMAS['home.philosophy'].parse({
      eyebrow: 'فلسفه',
      headline,
      accent: 'x',
      body: 'متن',
    });
    expect(parsed.headline).toBe(headline);
  });
});
