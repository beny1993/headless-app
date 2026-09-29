import { describe, expect, it } from 'vitest';
import {
  classifyUserSearch,
  MAX_USER_SEARCH_LENGTH,
  userSearchSchema,
} from '@/lib/users/user-search';

const CANONICAL = '+989121234567';

describe('classifyUserSearch', () => {
  it.each([
    ['09121234567'],
    ['+989121234567'],
    ['00989121234567'],
    ['9121234567'],
    ['۰۹۱۲۱۲۳۴۵۶۷'],
    ['٠٩١٢١٢٣٤٥٦٧'],
    ['0912 123 4567'],
  ])('reads the full number %s as the canonical phone', (q) => {
    expect(classifyUserSearch(q)).toEqual({ by: 'phone', phone: CANONICAL });
  });

  it.each([
    ['0912123', '+98912123'],
    ['۰۹۱۲۱۲۳', '+98912123'],
    ['09', '+989'],
    // Written the way a contact card groups it.
    ['0912 123', '+98912123'],
    ['0912-123', '+98912123'],
    ['(0912) 123', '+98912123'],
  ])('reads the partial %s as a phone prefix', (q, prefix) => {
    expect(classifyUserSearch(q)).toEqual({ by: 'phonePrefix', prefix });
  });

  it.each([
    // No leading 0: a name search (Benyamin, 2026-09-29).
    ['912123'],
    ['سارا'],
    ['Sara'],
    ['09a'],
    ['100%'],
    ['a_b'],
  ])('reads %s as a name fragment, as typed', (q) => {
    expect(classifyUserSearch(q)).toEqual({ by: 'name', text: q });
  });
});

describe('userSearchSchema', () => {
  const parse = (value: unknown) =>
    userSearchSchema.optional().catch(undefined).parse(value);

  it('trims and keeps a search', () => {
    expect(parse('  سارا  ')).toBe('سارا');
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['too long', 'a'.repeat(MAX_USER_SEARCH_LENGTH + 1)],
    ['a NUL byte', `a${String.fromCharCode(0)}b`],
    ['a bidi override', `a${String.fromCharCode(0x202e)}b`],
    ['repeated', ['a', 'b']],
  ])('degrades %s to no search', (_label, value) => {
    expect(parse(value)).toBeUndefined();
  });

  it('keeps a search at exactly the length bound', () => {
    const q = 'a'.repeat(MAX_USER_SEARCH_LENGTH);
    expect(parse(q)).toBe(q);
  });
});
