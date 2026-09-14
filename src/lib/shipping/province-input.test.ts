// Pure schema + normalizer behaviour — no database. Every invisible or
// look-alike target is constructed from an escape, never typed (the repo's
// control-character rule), so a failure names the code point involved.
import { describe, expect, it } from 'vitest';
import {
  normalizeProvinceName,
  PROVINCE_MESSAGES,
  PROVINCE_NAME_MAX_LENGTH,
  provinceCreateSchema,
  provinceToggleSchema,
} from './province-input';

const ARABIC_YEH = '\u064A';
const ALEF_MAKSURA = '\u0649';
const PERSIAN_YEH = '\u06CC';
const ARABIC_KAF = '\u0643';
const PERSIAN_KEHEH = '\u06A9';
const ZWNJ = '\u200C';
const NBSP = '\u00A0';
const BOM = '\uFEFF';
const RLO = '\u202E';
const NUL = String.fromCharCode(0);
const ZWSP = '\u200B';
const RLM = '\u200F';

/** Every invisible character that once let a visually identical second province in. */
const INVISIBLES: [string, string][] = [
  ['U+200B zero width space', ZWSP],
  ['U+200C zero width non-joiner', ZWNJ],
  ['U+200D zero width joiner', '\u200D'],
  ['U+2060 word joiner', '\u2060'],
  ['U+00AD soft hyphen', '\u00AD'],
  ['U+180E Mongolian vowel separator', '\u180E'],
  ['U+034F combining grapheme joiner', String.fromCharCode(0x034f)],
  ['U+200E left-to-right mark', '\u200E'],
  ['U+200F right-to-left mark', RLM],
  ['U+061C Arabic letter mark', '\u061C'],
  ['U+3164 Hangul filler', String.fromCharCode(0x3164)],
  ['U+115F Hangul choseong filler', String.fromCharCode(0x115f)],
  ['U+FFA0 halfwidth Hangul filler', String.fromCharCode(0xffa0)],
  ['U+FE0F variation selector 16', String.fromCharCode(0xfe0f)],
  ['U+180B Mongolian free variation selector', String.fromCharCode(0x180b)],
  ['U+17B4 Khmer vowel inherent', String.fromCharCode(0x17b4)],
  ['U+E0100 variation selector 17', String.fromCodePoint(0xe0100)],
  ['U+2800 braille blank', String.fromCharCode(0x2800)],
];

describe('normalizeProvinceName', () => {
  it('folds Arabic yeh and alef maksura to Persian yeh', () => {
    expect(normalizeProvinceName(`${ARABIC_YEH}زد`)).toBe(`${PERSIAN_YEH}زد`);
    expect(normalizeProvinceName(`${ALEF_MAKSURA}زد`)).toBe(`${PERSIAN_YEH}زد`);
  });

  it('folds Arabic kaf to Persian keheh, so «كرمان» and «کرمان» are one name', () => {
    expect(normalizeProvinceName(`${ARABIC_KAF}رمان`)).toBe(
      normalizeProvinceName(`${PERSIAN_KEHEH}رمان`),
    );
  });

  it('trims and collapses whitespace runs, NBSP and BOM included', () => {
    expect(normalizeProvinceName(`  خراسان${NBSP}${NBSP} رضوی${BOM} `)).toBe(
      'خراسان رضوی',
    );
  });

  it('preserves ZWNJ and digits — a display name, not search text', () => {
    const name = `چهارمحال${ZWNJ}وبختیاری ۲`;
    expect(normalizeProvinceName(name)).toBe(name);
  });

  it('is idempotent', () => {
    const once = normalizeProvinceName(
      ` ${ARABIC_KAF}ه${ARABIC_YEH}لو${NBSP} `,
    );
    expect(normalizeProvinceName(once)).toBe(once);
  });
});

describe('normalizeProvinceName — invisible look-alikes', () => {
  it.each(INVISIBLES)(
    'strips a leading or trailing %s, so «تهران» stays one name',
    (_label, invisible) => {
      expect(normalizeProvinceName(`تهران${invisible}`)).toBe('تهران');
      expect(normalizeProvinceName(`${invisible}تهران`)).toBe('تهران');
    },
  );

  it('removes a ZWNJ at either end or beside a space', () => {
    expect(normalizeProvinceName(`خراسان${ZWNJ} رضوی`)).toBe('خراسان رضوی');
    expect(normalizeProvinceName(`خراسان ${ZWNJ}رضوی`)).toBe('خراسان رضوی');
    expect(normalizeProvinceName(`خراسان ${ZWNJ} رضوی`)).toBe('خراسان رضوی');
    expect(normalizeProvinceName(` ${ZWNJ}${ZWNJ} تهران${NBSP}${ZWNJ}`)).toBe(
      'تهران',
    );
  });

  it('keeps a ZWNJ inside a word, collapsing a run of them to one', () => {
    const name = `آزمون${ZWNJ}آباد`;
    expect(normalizeProvinceName(name)).toBe(name);
    expect(normalizeProvinceName(`آزمون${ZWNJ}${ZWNJ}${ZWNJ}آباد`)).toBe(name);
    // A stripped character between two ZWNJs does not keep them apart.
    expect(normalizeProvinceName(`آزمون${ZWNJ}${ZWSP}${ZWNJ}آباد`)).toBe(name);
  });

  it('is idempotent over every look-alike case', () => {
    const cases = INVISIBLES.flatMap(([, invisible]) => [
      `تهران${invisible}`,
      `${invisible}تهران`,
      `آزمون${invisible}آباد`,
      ` ${invisible} خراسان${ZWNJ}${invisible} ${ZWNJ}رضوی ${invisible}`,
      `آزمون${ZWNJ}${invisible}${ZWNJ}آباد`,
    ]);
    for (const raw of cases) {
      const once = normalizeProvinceName(raw);
      expect(normalizeProvinceName(once)).toBe(once);
    }
  });
});

describe('provinceCreateSchema', () => {
  const firstMessage = (body: unknown) => {
    const result = provinceCreateSchema.safeParse(body);
    return result.success ? undefined : result.error.issues[0].message;
  };

  it('accepts a Persian name and a fee, returning the name normalized', () => {
    expect(
      provinceCreateSchema.parse({ name: ` ${ARABIC_KAF}رمان `, fee: 30_000 }),
    ).toEqual({ name: `${PERSIAN_KEHEH}رمان`, fee: 30_000 });
  });

  it('refuses a missing, empty or whitespace-only name in Persian', () => {
    expect(firstMessage({ fee: 0 })).toBe(PROVINCE_MESSAGES.name);
    expect(firstMessage({ name: '', fee: 0 })).toBe(PROVINCE_MESSAGES.name);
    expect(firstMessage({ name: `  ${NBSP} `, fee: 0 })).toBe(
      PROVINCE_MESSAGES.name,
    );
  });

  it('refuses a name made only of invisible characters', () => {
    expect(firstMessage({ name: `${ZWNJ}${ZWNJ}`, fee: 0 })).toBe(
      PROVINCE_MESSAGES.name,
    );
    expect(firstMessage({ name: `${ZWSP}${RLM}\u00AD`, fee: 0 })).toBe(
      PROVINCE_MESSAGES.name,
    );
  });

  it('refuses a name of Hangul fillers or braille blanks, which pass VISIBLE_CHAR raw but normalize to empty', () => {
    for (const name of [
      String.fromCharCode(0x3164, 0x3164),
      String.fromCharCode(0x115f, 0x1160),
      String.fromCharCode(0x2800),
      `${String.fromCharCode(0xffa0)}${ZWNJ}${String.fromCharCode(0x2800)}`,
    ]) {
      expect(firstMessage({ name, fee: 0 })).toBe(PROVINCE_MESSAGES.name);
    }
  });

  it('returns a name with an invisible character appended as the existing name', () => {
    for (const invisible of [ZWNJ, ZWSP, RLM]) {
      expect(
        provinceCreateSchema.parse({ name: `تهران${invisible}`, fee: 0 }).name,
      ).toBe('تهران');
    }
  });

  it('caps the name at the limit, measured after trim', () => {
    const atLimit = 'ب'.repeat(PROVINCE_NAME_MAX_LENGTH);
    expect(
      provinceCreateSchema.safeParse({ name: ` ${atLimit} `, fee: 0 }),
    ).toMatchObject({ success: true });
    expect(firstMessage({ name: `${atLimit}ب`, fee: 0 })).toBe(
      PROVINCE_MESSAGES.nameLength,
    );
  });

  it('refuses a null byte and a bidi override', () => {
    expect(firstMessage({ name: `قم${NUL}`, fee: 0 })).toBe(
      PROVINCE_MESSAGES.nameChars,
    );
    expect(firstMessage({ name: `${RLO}قم`, fee: 0 })).toBe(
      PROVINCE_MESSAGES.nameChars,
    );
  });

  it('takes a free (zero) fee but refuses negative, fractional and string fees', () => {
    expect(provinceCreateSchema.safeParse({ name: 'قم', fee: 0 }).success).toBe(
      true,
    );
    for (const fee of [-1, 1.5, '1000', null]) {
      expect(firstMessage({ name: 'قم', fee })).toBe(PROVINCE_MESSAGES.fee);
    }
  });

  it('strips keys the body may not set', () => {
    expect(
      provinceCreateSchema.parse({
        name: 'قم',
        fee: 0,
        id: 9,
        isActive: false,
      }),
    ).toEqual({ name: 'قم', fee: 0 });
  });
});

describe('provinceToggleSchema', () => {
  it('accepts only a real boolean', () => {
    expect(provinceToggleSchema.parse({ isActive: false })).toEqual({
      isActive: false,
    });
    expect(provinceToggleSchema.parse({ isActive: true, fee: 1 })).toEqual({
      isActive: true,
    });
    for (const isActive of ['false', 0, null, undefined]) {
      expect(provinceToggleSchema.safeParse({ isActive }).success).toBe(false);
    }
  });
});
