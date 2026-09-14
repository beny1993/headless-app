import { describe, expect, it } from 'vitest';
import { foldPersianLetters, normalizeSearchText } from './search-text';

/**
 * Named code points, so a failure reads as «which character» rather than as two
 * Persian glyphs that look identical in a diff. These are exactly the pairs an
 * Arabic keyboard (and half the copy-pasted product data on the Iranian web)
 * produces where Persian wants its own letter.
 */
const ARABIC_YEH = 'ي'; // ي
const ALEF_MAKSURA = 'ى'; // ى
const PERSIAN_YEH = 'ی'; // ی
const ARABIC_KAF = 'ك'; // ك
const PERSIAN_KEHEH = 'ک'; // ک
const ZWNJ = '‌';
const TATWEEL = 'ـ';

describe('normalizeSearchText', () => {
  describe('the letters an Arabic keyboard gets wrong', () => {
    it('maps Arabic yeh to Persian yeh', () => {
      expect(normalizeSearchText(`غذا${ARABIC_YEH}`)).toBe(`غذا${PERSIAN_YEH}`);
    });

    it('maps alef maksura to Persian yeh', () => {
      expect(normalizeSearchText(`غذا${ALEF_MAKSURA}`)).toBe(
        `غذا${PERSIAN_YEH}`,
      );
    });

    it('maps Arabic kaf to Persian keheh', () => {
      expect(normalizeSearchText(`خش${ARABIC_KAF}`)).toBe(`خش${PERSIAN_KEHEH}`);
    });

    it('leaves the Persian letters themselves alone', () => {
      expect(normalizeSearchText(`خشک${PERSIAN_YEH}`)).toBe(
        `خشک${PERSIAN_YEH}`,
      );
    });

    it('maps every Arabic variant in one word', () => {
      // «كيلوگرمي» typed entirely on an Arabic keyboard.
      expect(
        normalizeSearchText(`${ARABIC_KAF}${ARABIC_YEH}لوگرم${ARABIC_YEH}`),
      ).toBe(`${PERSIAN_KEHEH}${PERSIAN_YEH}لوگرم${PERSIAN_YEH}`);
    });
  });

  describe('digits — one script for every number', () => {
    it('maps Arabic-Indic digits to ASCII', () => {
      expect(normalizeSearchText('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    });

    it('maps Persian digits to ASCII', () => {
      expect(normalizeSearchText('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    });

    it('leaves ASCII digits alone', () => {
      expect(normalizeSearchText('2 کیلوگرم')).toBe('2 کیلوگرم');
    });

    it('makes a Persian-typed weight and an ASCII-typed one the same text', () => {
      // The shopper types «2 کیلویی», the product title says «۲ کیلویی».
      expect(normalizeSearchText('۲ کیلویی')).toBe(
        normalizeSearchText('2 کیلویی'),
      );
    });
  });

  describe('marks that carry no sound', () => {
    it('strips harakat', () => {
      // غَذایِ — fathe and kasre, which nobody types into a search box.
      expect(normalizeSearchText('غَذایِ')).toBe('غذای');
    });

    it('strips tashdid and sukun', () => {
      expect(normalizeSearchText('مُشَدَّدْ')).toBe('مشدد');
    });

    it('strips tatweel, the decorative stretch', () => {
      expect(normalizeSearchText(`خ${TATWEEL}${TATWEEL}شک`)).toBe('خشک');
    });

    it('makes a vowelled word and a bare one the same text', () => {
      expect(normalizeSearchText('غِذا')).toBe(normalizeSearchText('غذا'));
    });
  });

  describe('ZWNJ — the separator Persian typists swap for a space', () => {
    it('becomes a space, so «اسباب‌بازی» and «اسباب بازی» are one string', () => {
      expect(normalizeSearchText(`اسباب${ZWNJ}بازی`)).toBe('اسباب بازی');
    });

    it('collapses a ZWNJ that already sits next to a space', () => {
      expect(normalizeSearchText(`اسباب ${ZWNJ}بازی`)).toBe('اسباب بازی');
    });

    it('drops the other zero-width characters the clipboard brings along', () => {
      // ZWJ, zero-width space and a BOM, all invisible and all noise.
      expect(normalizeSearchText('غذای‍خشک​﻿')).toBe('غذای خشک');
    });
  });

  describe('whitespace', () => {
    it('collapses runs of spaces', () => {
      expect(normalizeSearchText('غذای    خشک')).toBe('غذای خشک');
    });

    it('turns newlines and tabs into single spaces', () => {
      expect(normalizeSearchText('غذای\n\tخشک')).toBe('غذای خشک');
    });

    it('trims the ends', () => {
      expect(normalizeSearchText('  غذای خشک  ')).toBe('غذای خشک');
    });
  });

  describe('what it must not touch', () => {
    it('passes Latin brand names through unchanged, case included', () => {
      // Case folding is pg_trgm's job — it lowercases when it extracts
      // trigrams — so doing it here would only make the stored column a worse
      // record of the product.
      expect(normalizeSearchText('Royal Canin')).toBe('Royal Canin');
    });

    it('keeps an apostrophe inside a brand', () => {
      expect(normalizeSearchText("Hill's Science")).toBe("Hill's Science");
    });

    it('leaves clean Persian text exactly as it was', () => {
      expect(normalizeSearchText('شامپو ضد کک و کنه سگ')).toBe(
        'شامپو ضد کک و کنه سگ',
      );
    });
  });

  describe('the properties the write path and the query path both rely on', () => {
    it('is idempotent', () => {
      const once = normalizeSearchText(
        `اسباب${ZWNJ}باز${ARABIC_YEH}  ${ARABIC_KAF}لاس ۲`,
      );

      expect(normalizeSearchText(once)).toBe(once);
    });

    it('normalizes a mixed Persian, Arabic-typed and Latin string in one pass', () => {
      expect(
        normalizeSearchText(
          `  غذا${ARABIC_YEH} خش${ARABIC_KAF}${ZWNJ}شده Royal Canin ۲   `,
        ),
      ).toBe('غذای خشک شده Royal Canin 2');
    });

    it('returns an empty string for an empty one', () => {
      expect(normalizeSearchText('')).toBe('');
    });

    it('returns an empty string for text that is nothing but noise', () => {
      // A query of only ZWNJ and spaces has to normalize to nothing, because
      // the DAO reads an empty term as «no search» rather than as a term that
      // matches nothing.
      expect(normalizeSearchText(`  ${ZWNJ} ${ZWNJ}  `)).toBe('');
    });
  });
});

describe('foldPersianLetters', () => {
  it('folds only the Arabic yeh/kaf letters — ZWNJ, digits and spacing survive', () => {
    expect(
      foldPersianLetters(`${ARABIC_KAF}${ALEF_MAKSURA}\u200C۲  ${ARABIC_YEH}`),
    ).toBe(`${PERSIAN_KEHEH}${PERSIAN_YEH}\u200C۲  ${PERSIAN_YEH}`);
  });
});
