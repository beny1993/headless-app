// The content contract's rules, proven directly — no DB, no browser. Every rule
// the security pass leans on lives here: image-key shapes accepted and rejected,
// the fixed-count tuples, the string ceilings, the NUL gate, whitespace-only,
// and that extra fields are stripped rather than stored.
import { describe, expect, it } from 'vitest';
import {
  CONTENT_AREAS,
  CONTENT_KEYS,
  CONTENT_SCHEMAS,
  contentAreaSchema,
  contentKeySchema,
  imageKeySchema,
  isVisible,
  type ContentKey,
} from './site-content';
import { DEFAULT_CONTENT } from './defaults';

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
  // Spread the default so the whole (v2-extended) shape is valid, and each case
  // overrides just the field it probes — a new required field never re-breaks this.
  const base = DEFAULT_CONTENT['home.hero'];

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
      cta: 'y',
      role: 'admin',
      injected: '<script>',
    }) as Record<string, unknown>;
    expect(parsed).toEqual({ headline: 'x', cta: 'y' });
  });
});

describe('CONTENT_SCHEMAS visibility flag', () => {
  const base = DEFAULT_CONTENT['home.hero'];
  const cta = DEFAULT_CONTENT['about.cta'];

  it('is optional — omitted parses and leaves visible undefined (shown)', () => {
    expect(CONTENT_SCHEMAS['home.hero'].parse(base).visible).toBeUndefined();
    // Even the smallest content block carries it.
    expect(CONTENT_SCHEMAS['about.cta'].parse(cta).visible).toBe(undefined);
  });

  it('accepts an explicit true or false', () => {
    expect(
      CONTENT_SCHEMAS['home.hero'].parse({ ...base, visible: false }).visible,
    ).toBe(false);
    expect(
      CONTENT_SCHEMAS['about.cta'].parse({ ...cta, visible: true }).visible,
    ).toBe(true);
  });

  it('rejects a non-boolean visible', () => {
    expect(
      CONTENT_SCHEMAS['home.hero'].safeParse({ ...base, visible: 'yes' })
        .success,
    ).toBe(false);
  });

  it('has no visible field on the chrome blocks (header/footer)', () => {
    // The toggle is derived from `'visible' in schema.shape`, so its ABSENCE on
    // these two is what removes it from the editor for chrome.
    expect('visible' in CONTENT_SCHEMAS.header.shape).toBe(false);
    expect('visible' in CONTENT_SCHEMAS.footer.shape).toBe(false);
    // …and present on a content block.
    expect('visible' in CONTENT_SCHEMAS['home.hero'].shape).toBe(true);
  });
});

describe('CONTENT_SCHEMAS fixed-count lists', () => {
  const slot = (name: string) => ({
    image: 'site/community-luna.jpg',
    name,
    owner: 'o',
    quote: 'q',
  });

  const family = (slots: unknown) => ({
    eyebrow: 'e',
    headline: 'h',
    slots,
  });

  it('requires exactly five family slots', () => {
    const five = [slot('1'), slot('2'), slot('3'), slot('4'), slot('5')];
    expect(CONTENT_SCHEMAS['home.family'].safeParse(family(five)).success).toBe(
      true,
    );
    expect(
      CONTENT_SCHEMAS['home.family'].safeParse(family(five.slice(0, 4)))
        .success,
    ).toBe(false);
    expect(
      CONTENT_SCHEMAS['home.family'].safeParse(family([...five, slot('6')]))
        .success,
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
    expect(CONTENT_SCHEMAS['home.family'].safeParse(family(bad)).success).toBe(
      false,
    );
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
      cta: 'بیشتر',
    });
    expect(parsed.headline).toBe(headline);
  });
});

describe('CONTENT_AREAS', () => {
  it('partitions CONTENT_KEYS — every key in exactly one area', () => {
    const fromAreas = Object.values(CONTENT_AREAS).flatMap((a) => [...a.keys]);
    // No key appears twice across the areas…
    expect(new Set(fromAreas).size).toBe(fromAreas.length);
    // …and the areas cover exactly CONTENT_KEYS, no more, no less.
    expect(new Set(fromAreas)).toEqual(new Set(CONTENT_KEYS));
    expect(fromAreas).toHaveLength(CONTENT_KEYS.length);
  });

  it('lists every area key in contentAreaSchema and gives each a title', () => {
    for (const area of Object.keys(CONTENT_AREAS)) {
      expect(contentAreaSchema.safeParse(area).success, area).toBe(true);
      expect(
        CONTENT_AREAS[area as keyof typeof CONTENT_AREAS].title.length,
      ).toBeGreaterThan(0);
    }
    // contentAreaSchema accepts exactly the CONTENT_AREAS keys.
    expect(contentAreaSchema.options.slice().sort()).toEqual(
      Object.keys(CONTENT_AREAS).sort(),
    );
    // A stray area is rejected — the [area] page turns this into a 404.
    expect(contentAreaSchema.safeParse('nope').success).toBe(false);
  });

  it('each area references only real content keys', () => {
    const known = new Set<string>(CONTENT_KEYS);
    for (const area of Object.values(CONTENT_AREAS)) {
      for (const key of area.keys) expect(known.has(key)).toBe(true);
    }
  });
});

describe('CONTENT_SCHEMAS chrome + new home blocks', () => {
  it('requires a 3-label nav on the header and rejects a wrong count', () => {
    const base = DEFAULT_CONTENT.header;
    expect(CONTENT_SCHEMAS.header.safeParse(base).success).toBe(true);
    expect(
      CONTENT_SCHEMAS.header.safeParse({ ...base, nav: ['a', 'b'] }).success,
    ).toBe(false);
    expect(
      CONTENT_SCHEMAS.header.safeParse({ ...base, nav: ['a', 'b', 'c', 'd'] })
        .success,
    ).toBe(false);
  });

  it('requires footer columns of exactly 5 and 1 links', () => {
    const base = DEFAULT_CONTENT.footer;
    expect(CONTENT_SCHEMAS.footer.safeParse(base).success).toBe(true);
    const shortFirst = {
      ...base,
      columns: [
        { title: 'x', links: ['a', 'b', 'c', 'd'] },
        { title: 'y', links: ['z'] },
      ],
    };
    expect(CONTENT_SCHEMAS.footer.safeParse(shortFirst).success).toBe(false);
  });

  it('requires exactly five moment cards, each with a valid image key', () => {
    const base = DEFAULT_CONTENT['home.moments'];
    expect(CONTENT_SCHEMAS['home.moments'].safeParse(base).success).toBe(true);
    expect(
      CONTENT_SCHEMAS['home.moments'].safeParse({
        ...base,
        cards: base.cards.slice(0, 4),
      }).success,
    ).toBe(false);
    const badImage = {
      ...base,
      cards: [
        { ...base.cards[0], image: 'http://evil/x.jpg' },
        ...base.cards.slice(1),
      ],
    };
    expect(CONTENT_SCHEMAS['home.moments'].safeParse(badImage).success).toBe(
      false,
    );
  });

  it('requires exactly four routine slots', () => {
    const base = DEFAULT_CONTENT['home.routine'];
    expect(CONTENT_SCHEMAS['home.routine'].safeParse(base).success).toBe(true);
    expect(
      CONTENT_SCHEMAS['home.routine'].safeParse({
        ...base,
        slots: base.slots.slice(0, 3),
      }).success,
    ).toBe(false);
  });
});

describe('isVisible', () => {
  it('shows when visible is absent or true, hides only on explicit false', () => {
    expect(isVisible({})).toBe(true);
    expect(isVisible({ visible: true })).toBe(true);
    expect(isVisible({ visible: false })).toBe(false);
  });

  it('treats every content default as shown, and chrome as shown', () => {
    for (const key of CONTENT_KEYS as readonly ContentKey[]) {
      // Cast because the chrome values (header/footer) carry no `visible` field
      // at all, so they share no property with isVisible's `{ visible?: boolean }`
      // param — a TS weak-type nuance, not a runtime one: isVisible still returns
      // true for them, which is exactly what "chrome is always shown" means.
      expect(
        isVisible(DEFAULT_CONTENT[key] as { visible?: boolean }),
        key,
      ).toBe(true);
    }
  });
});
