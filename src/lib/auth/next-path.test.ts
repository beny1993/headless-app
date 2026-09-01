import { describe, expect, it } from 'vitest';
import { PATHS } from '@/lib/constant/paths';
import { nextPathSchema, safeNextPath } from './next-path';

describe('safeNextPath', () => {
  describe('keeps a genuine destination on this site', () => {
    it.each([
      ['the admin panel', '/admin-panel'],
      ['a product page', '/product/cat-dry-food'],
      ['the shop with filters', '/shop?category=food&pet=cat'],
      ['a path with a fragment', '/checkout#payment'],
      ['the account page', '/account'],
      ['a percent-encoded Persian slug', '/product/%D8%BA%D8%B0%D8%A7'],
      ['the home page itself', '/'],
    ])('%s', (_label, input) => {
      expect(safeNextPath(input)).toBe(input);
    });
  });

  describe('refuses to send anyone off this site', () => {
    it.each([
      ['an absolute http URL', 'http://evil.example/phish'],
      ['an absolute https URL', 'https://evil.example/phish'],
      ['a protocol-relative URL', '//evil.example/phish'],
      ['a protocol-relative URL with a backslash', '/\\evil.example'],
      ['both slashes backslashed', '\\\\evil.example'],
      ['a javascript: URL', 'javascript:alert(1)'],
      ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
      ['a scheme-relative URL with credentials', '//user:pass@evil.example'],
      ['an uppercase scheme', 'HTTPS://evil.example'],
      ['a scheme with whitespace padding', '  https://evil.example'],
      ['a bare host', 'evil.example/phish'],
      ['a relative path that climbs', '../admin-panel'],
      ['a path not starting with a slash', 'admin-panel'],
      ['an empty string', ''],
      ['whitespace', '   '],
    ])('%s', (_label, input) => {
      // Everything unsafe lands on the storefront, never on the attacker's URL.
      expect(safeNextPath(input)).toBe(PATHS.HOME);
    });

    it('refuses a URL smuggled behind a newline', () => {
      // Header- and log-splitting shapes; a stripped newline must not reveal a
      // destination that was rejected before the strip.
      const newline = String.fromCharCode(0x0a);
      expect(safeNextPath(`/shop${newline}//evil.example`)).toBe(PATHS.HOME);
    });

    it('refuses a URL carrying a carriage return', () => {
      const carriageReturn = String.fromCharCode(0x0d);
      expect(safeNextPath(`${carriageReturn}//evil.example`)).toBe(PATHS.HOME);
    });

    it('refuses a path containing a NUL byte', () => {
      const nul = String.fromCharCode(0);
      expect(safeNextPath(`/shop${nul}`)).toBe(PATHS.HOME);
    });

    it('refuses a tab-padded scheme', () => {
      const tab = String.fromCharCode(0x09);
      expect(safeNextPath(`${tab}https://evil.example`)).toBe(PATHS.HOME);
    });
  });

  describe('refuses anything that is not a path at all', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a number', 42],
      ['an array — a repeated ?next= parameter', ['/shop', '/admin-panel']],
      ['an object', { next: '/shop' }],
    ])('%s', (_label, input) => {
      expect(safeNextPath(input)).toBe(PATHS.HOME);
    });

    it('refuses an absurdly long path', () => {
      expect(safeNextPath(`/${'a'.repeat(5000)}`)).toBe(PATHS.HOME);
    });
  });

  it('is idempotent — a sanitized path survives a second pass', () => {
    expect(safeNextPath(safeNextPath('/shop?pet=cat'))).toBe('/shop?pet=cat');
  });
});

describe('nextPathSchema', () => {
  it('parses a real destination', () => {
    expect(nextPathSchema.parse('/admin-panel')).toBe('/admin-panel');
  });

  it('degrades bad input to the home page instead of throwing', () => {
    // Page `searchParams` degrade rather than 400 (AGENTS.md); a login page
    // that errors because someone tampered with a query string is a worse
    // outcome than a login page that ignores it.
    expect(nextPathSchema.parse('https://evil.example')).toBe(PATHS.HOME);
    expect(nextPathSchema.parse(undefined)).toBe(PATHS.HOME);
  });
});
