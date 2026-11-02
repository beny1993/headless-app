// The content contract's rules, proven directly — no DB, no browser. Every rule
// the security pass leans on lives here: image-key shapes accepted and rejected,
// the fixed-count tuples, the string ceilings, the NUL gate, whitespace-only,
// and that extra fields are stripped rather than stored.
import { describe, expect, it } from 'vitest';
import {
  CONTENT_AREAS,
  CONTENT_KEYS,
  CONTENT_SCHEMAS,
  FEATURED_COUNT,
  FOOTER_SOCIAL_DEFAULT,
  HANDLE_MESSAGES,
  contentAreaSchema,
  contentKeySchema,
  instagramUrl,
  isVisible,
  telegramUrl,
  type ContentKey,
} from './site-content';
import { imageKeySchema } from '@/lib/storage/image-upload';
import { DEFAULT_CONTENT } from './defaults';

const NUL = String.fromCharCode(0);
const RLO = String.fromCharCode(0x202e);

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
      'products/lamp.jpg',
      'products/candle.png',
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

  it('rejects a bidi override in a string field', () => {
    // A content row renders to every visitor, not just to an admin.
    expect(
      CONTENT_SCHEMAS['home.hero'].safeParse({
        ...base,
        headline: `نمونه${RLO}`,
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
});

describe('CONTENT_SCHEMAS checkout.payment', () => {
  const base = DEFAULT_CONTENT['checkout.payment'];
  const schema = CONTENT_SCHEMAS['checkout.payment'];
  const withCard = (number: string) => ({
    ...base,
    bankCards: [
      { bank: 'ملت', number, holder: 'سارا محمدی' },
      base.bankCards[1],
      base.bankCards[2],
    ],
  });

  it('normalizes a card number to sixteen ASCII digits', () => {
    for (const typed of [
      '6037997512345678',
      '6037-9975-1234-5678',
      '6037 9975 1234 5678',
      '۶۰۳۷۹۹۷۵۱۲۳۴۵۶۷۸',
      ' ۶۰۳۷-۹۹۷۵ ۱۲۳۴-۵۶۷۸ ',
    ]) {
      const parsed = schema.parse(withCard(typed));
      expect(parsed.bankCards[0].number, typed).toBe('6037997512345678');
      expect(parsed.bankCards[0].bank).toBe('ملت');
      expect(parsed.bankCards[0].holder).toBe('سارا محمدی');
    }
  });

  it('rejects a card number that is not sixteen digits, on its own path', () => {
    for (const bad of [
      '603799751234567',
      '60379975123456789',
      '6037-9975-1234-567x',
    ]) {
      const result = schema.safeParse(withCard(bad));
      expect(result.success, bad).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['bankCards', 0, 'number']);
      }
    }
  });

  it('keeps an empty slot and a cleared handle blank — the shipped spares are', () => {
    const parsed = schema.parse({
      ...base,
      bankCards: [
        base.bankCards[0],
        { bank: ' ', number: '  ', holder: '' },
        base.bankCards[2],
      ],
      instagram: '  ',
    });
    // A whitespace handle is a cleared one: stored as `''`, never as the default.
    expect(parsed).toEqual({ ...base, instagram: '' });
    // The default ships every slot blank: a shop fills in its own cards.
    expect(base.bankCards.every((card) => card.number === '')).toBe(true);
  });

  it('stores a social handle bare — typed, with an @, or pasted as the profile URL', () => {
    expect(schema.parse({ ...base, instagram: '@demo.store' }).instagram).toBe(
      'demo.store',
    );
    expect(schema.parse({ ...base, telegram: ' demo_store ' }).telegram).toBe(
      'demo_store',
    );
    // What an admin pastes from the app: share token, www, trailing slash,
    // no scheme, an @ in the path, upper-case host — all reduce to the handle.
    for (const pasted of [
      'https://www.instagram.com/demo.daily?stkn=NWkxMDlrYWtqY2Jn',
      'https://instagram.com/demo.daily/',
      'instagram.com/@demo.daily',
      'HTTPS://WWW.INSTAGRAM.COM/demo.daily#top',
    ]) {
      expect(
        schema.parse({ ...base, instagram: pasted }).instagram,
        pasted,
      ).toBe('demo.daily');
    }
    for (const pasted of [
      'https://t.me/demoshop',
      'telegram.me/demoshop?start=x',
    ]) {
      expect(schema.parse({ ...base, telegram: pasted }).telegram, pasted).toBe(
        'demoshop',
      );
    }
  });

  it('refuses anything but a username, and another network’s URL with its own message', () => {
    const message = (value: string, field: 'instagram' | 'telegram') => {
      const result = schema.safeParse({ ...base, [field]: value });
      expect(result.success, value).toBe(false);
      return result.success ? '' : result.error.issues[0].message;
    };
    for (const bad of [
      'demo shop',
      'demo/shop',
      'a'.repeat(33),
      'https://instagram.com/',
    ]) {
      expect(message(bad, 'instagram'), bad).toBe(HANDLE_MESSAGES.username);
    }
    // A Telegram link in the Instagram field (and the reverse) is not silently
    // rehosted; nor is any other site's URL.
    expect(message('https://t.me/demoshop', 'instagram')).toBe(
      HANDLE_MESSAGES.host,
    );
    expect(message('https://instagram.com/demo.shop', 'telegram')).toBe(
      HANDLE_MESSAGES.host,
    );
    expect(message('https://example.com/demo', 'instagram')).toBe(
      HANDLE_MESSAGES.host,
    );
  });

  it('requires the note', () => {
    expect(schema.safeParse({ ...base, note: '  ' }).success).toBe(false);
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

describe('CONTENT_SCHEMAS link fields (every one optional: compat)', () => {
  const IDS = [
    '5f0c6a8e-3b1d-4c2a-9e7f-1a2b3c4d5e6f',
    '0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b',
    '7e6d5c4b-3a2f-4e1d-9c0b-a9f8e7d6c5b4',
    '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
    '8f7e6d5c-4b3a-4f2e-8d1c-0b9a8f7e6d5c',
  ];
  const shop = { type: 'shop', categoryId: IDS[0] };
  const external = { type: 'external', url: 'https://example.com/' };
  const d = DEFAULT_CONTENT;

  it('parses every block saved before links were editable to itself', () => {
    // Each default is a pre-change row: no link field anywhere. Nothing may be
    // required or defaulted in, or every live row would change or fall back.
    for (const key of CONTENT_KEYS) {
      expect(CONTENT_SCHEMAS[key].parse(DEFAULT_CONTENT[key]), key).toEqual(
        DEFAULT_CONTENT[key],
      );
    }
  });

  it('keeps a link, or null for "the code destination", at every link field', () => {
    const cases: [ContentKey, unknown][] = [
      [
        'home.hero',
        { ...d['home.hero'], shopCtaLink: shop, aboutCtaLink: null },
      ],
      ['home.guide', { ...d['home.guide'], ctaLink: shop }],
      [
        'home.categories',
        { ...d['home.categories'], ctaLink: { type: 'page', page: 'shop' } },
      ],
      [
        'home.philosophy',
        { ...d['home.philosophy'], ctaLink: { type: 'page', page: 'about' } },
      ],
      ['about.cta', { ...d['about.cta'], ctaLink: external }],
      ['header', { ...d.header, navLinks: [null, shop, external] }],
      [
        'footer',
        {
          ...d.footer,
          columns: [
            {
              ...d.footer.columns[0],
              linkTargets: [shop, null, null, null, external],
            },
            { ...d.footer.columns[1], linkTargets: [external] },
          ],
        },
      ],
    ];
    for (const [key, value] of cases) {
      expect(CONTENT_SCHEMAS[key].safeParse(value).data, key).toEqual(value);
    }
  });

  it('refuses a link list longer than its labels, and allows a shorter one', () => {
    expect(
      CONTENT_SCHEMAS.header.safeParse({
        ...d.header,
        navLinks: [null, null, null, external],
      }).success,
    ).toBe(false);
    expect(
      CONTENT_SCHEMAS.footer.safeParse({
        ...d.footer,
        columns: [
          d.footer.columns[0],
          { ...d.footer.columns[1], linkTargets: [external, external] },
        ],
      }).success,
    ).toBe(false);
    // A missing entry keeps its code destination.
    expect(
      CONTENT_SCHEMAS.header.safeParse({ ...d.header, navLinks: [shop] })
        .success,
    ).toBe(true);
  });

  it('reports a malformed link on the link field’s own path', () => {
    const result = CONTENT_SCHEMAS['about.cta'].safeParse({
      ...d['about.cta'],
      ctaLink: { type: 'external', url: 'javascript:alert(1)' },
    });
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual([
      'ctaLink.url',
    ]);
  });

  it('lets the home strip pick one to six distinct categories, or none', () => {
    const six = [...IDS, '4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d'];
    const seven = [...six, '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a'];
    const categories = d['home.categories'];
    const parse = (categoryIds: unknown) =>
      CONTENT_SCHEMAS['home.categories'].safeParse({
        ...categories,
        categoryIds,
      });

    // Unset is the default rule — the first six by display order.
    expect(parse(undefined).success).toBe(true);
    expect(parse([IDS[0]]).data).toEqual({
      ...categories,
      categoryIds: [IDS[0]],
    });
    expect(parse(six).success).toBe(true);
    for (const bad of [[], seven, [IDS[0], IDS[0]], ['dry-food']]) {
      expect(parse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('lets each «پیشنهادهای ما» box hold a product, or null for «خودکار»', () => {
    const recommends = d['home.recommends'];
    const parse = (productIds: unknown) =>
      CONTENT_SCHEMAS['home.recommends'].safeParse({
        ...recommends,
        productIds,
      });

    const picks = [IDS[0], null, IDS[1], null];
    expect(parse(picks).data).toEqual({ ...recommends, productIds: picks });
    expect(parse([null, null, null, null]).success).toBe(true);
    // A shorter list leaves the later boxes on «خودکار», so a grid that grows
    // never turns a saved row invalid — which would reset the whole block.
    expect(parse([IDS[0]]).success).toBe(true);
    expect(parse([]).success).toBe(true);
    // No more boxes than the grid lays out, and product ids only.
    for (const bad of [
      IDS.slice(0, FEATURED_COUNT + 1),
      [IDS[0], 'royal-canin'],
      [null, undefined],
    ]) {
      expect(parse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    // One product fills one box, refused on the picker's own path.
    expect(
      parse([IDS[0], null, IDS[0], null]).error?.issues.map((issue) =>
        issue.path.join('.'),
      ),
    ).toEqual(['productIds']);
  });
});

describe('CONTENT_SCHEMAS footer.social (a shipped key: defaulted, not required)', () => {
  const schema = CONTENT_SCHEMAS.footer;
  const { social: _social, ...legacyRow } = DEFAULT_CONTENT.footer;
  const cleared = { instagram: '', instagramDailies: '', telegram: '' };
  const DEMO_HANDLES = {
    instagram: 'demo.shop',
    instagramDailies: 'demo.daily',
    telegram: 'demoshop',
  };

  it('parses a row saved before the field existed to the real handles', () => {
    // On read AND in the editor (which seeds from the parsed value): a legacy
    // row shows the pills, and an unrelated save round-trips them.
    expect(schema.parse(legacyRow)).toEqual(DEFAULT_CONTENT.footer);
    expect(schema.parse(legacyRow).social).toEqual(FOOTER_SOCIAL_DEFAULT);
  });

  it('keeps a cleared handle empty — the admin can remove a pill', () => {
    expect(schema.parse({ ...legacyRow, social: cleared }).social).toEqual(
      cleared,
    );
    expect(
      schema.parse({ ...legacyRow, social: { ...cleared, telegram: 'x' } })
        .social,
    ).toEqual({ ...cleared, telegram: 'x' });
  });

  it('ships the default in stored form, so the short-circuit hands out valid handles', () => {
    // `.default()` never runs `handle` over its value; prove it would pass.
    expect(
      schema.parse({ ...legacyRow, social: FOOTER_SOCIAL_DEFAULT }).social,
    ).toEqual(FOOTER_SOCIAL_DEFAULT);
  });

  it('stores each handle bare — an @, or the pasted profile URL — and refuses another network’s URL on its own path', () => {
    expect(
      schema.parse({
        ...legacyRow,
        social: {
          instagram: '@demo.shop',
          instagramDailies: ' demo.daily ',
          telegram: '@demoshop',
        },
      }).social,
    ).toEqual(DEMO_HANDLES);
    // The three links as a shop owner pastes them from the app's share sheet.
    expect(
      schema.parse({
        ...legacyRow,
        social: {
          instagram:
            'https://www.instagram.com/demo.shop?stkn=OG9qN2ljaHNmeWU=',
          instagramDailies:
            'https://www.instagram.com/demo.daily?stkn=NWkxMDlrYWtqY2Jn',
          telegram: 'https://t.me/demoshop',
        },
      }).social,
    ).toEqual(DEMO_HANDLES);

    const result = schema.safeParse({
      ...legacyRow,
      social: { ...cleared, instagram: 'https://t.me/demoshop' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['social', 'instagram']);
      expect(result.error.issues[0].message).toBe(HANDLE_MESSAGES.host);
    }
  });

  it('links a stored handle to its canonical profile URL', () => {
    expect(instagramUrl('demo.daily')).toBe('https://instagram.com/demo.daily');
    expect(telegramUrl('demoshop')).toBe('https://t.me/demoshop');
  });
});
