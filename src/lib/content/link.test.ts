// The link contract, proven directly — no DB, no browser. What a destination may
// be (the four types, and the https-only gate on external URLs the security pass
// probes), where each one resolves (every branch, including the deleted-category
// and hidden-product fallbacks), and which catalog ids a block references (the
// save check and the render lookup both start from that list).
import { describe, expect, it } from 'vitest';
import { PATHS, productPath, shopPath } from '@/lib/constant/paths';
import { DEFAULT_CONTENT } from './defaults';
import {
  collectLinkRefs,
  LINK_MESSAGES,
  linkSchema,
  resolveLink,
  type LinkPage,
  type LinkTargets,
} from './link';

const NUL = String.fromCharCode(0);
const CATEGORY_ID = '5f0c6a8e-3b1d-4c2a-9e7f-1a2b3c4d5e6f';
const OTHER_CATEGORY_ID = '0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b';
const PRODUCT_ID = '9d8c7b6a-5f4e-4d3c-8b2a-0f1e2d3c4b5a';
const UNKNOWN_ID = '11111111-2222-4333-8444-555555555555';

const targets: LinkTargets = {
  categories: { [CATEGORY_ID]: 'dry-food' },
  products: { [PRODUCT_ID]: 'royal-canin-cat-sensible-2kg' },
};

describe('linkSchema', () => {
  it('accepts each destination type', () => {
    for (const link of [
      { type: 'page', page: 'home' },
      { type: 'page', page: 'shop' },
      { type: 'page', page: 'about' },
      { type: 'page', page: 'account' },
      { type: 'shop' },
      { type: 'shop', pet: 'cat' },
      { type: 'shop', categoryId: CATEGORY_ID },
      { type: 'shop', categoryId: CATEGORY_ID, pet: 'dog' },
      { type: 'product', productId: PRODUCT_ID },
      { type: 'external', url: 'https://example.com/' },
    ]) {
      expect(linkSchema.safeParse(link).success, JSON.stringify(link)).toBe(
        true,
      );
    }
  });

  it('rejects an unknown type, page or pet, and an id that is not a uuid', () => {
    for (const link of [
      {},
      { type: 'href', href: '/shop' },
      { type: 'page' },
      { type: 'page', page: 'admin-panel' },
      { type: 'shop', pet: 'bird' },
      { type: 'shop', categoryId: 'dry-food' },
      { type: 'product' },
      { type: 'product', productId: 'royal-canin-cat-sensible-2kg' },
      { type: 'external' },
    ]) {
      expect(linkSchema.safeParse(link).success, JSON.stringify(link)).toBe(
        false,
      );
    }
  });

  it('strips fields its type does not declare — a page link cannot smuggle a URL', () => {
    expect(
      linkSchema.parse({
        type: 'page',
        page: 'home',
        url: 'javascript:alert(1)',
        href: '//evil.example',
      }),
    ).toEqual({ type: 'page', page: 'home' });
  });

  it('reports an unknown type in Persian, on the type field', () => {
    expect(linkSchema.safeParse({ type: 'href' }).error?.issues).toMatchObject([
      { path: ['type'], message: LINK_MESSAGES.type },
    ]);
  });
});

describe('linkSchema external url', () => {
  const parseUrl = (url: string) =>
    linkSchema.safeParse({ type: 'external', url });

  it('accepts an absolute https URL and stores its normalized href', () => {
    expect(parseUrl('https://example.com').data).toEqual({
      type: 'external',
      url: 'https://example.com/',
    });
    // Trimmed, scheme and host lower-cased, the space percent-encoded.
    expect(parseUrl('  HTTPS://Example.COM/a b  ').data).toEqual({
      type: 'external',
      url: 'https://example.com/a%20b',
    });
  });

  it('parses a stored href back to itself (the DAO re-parses on write and read)', () => {
    for (const url of [
      'https://example.com/a b?q=1#top',
      'https://example.com/راهنمای-غذا',
    ]) {
      const stored = parseUrl(url).data;
      expect(stored, url).toBeDefined();
      expect(linkSchema.parse(stored)).toEqual(stored);
    }
  });

  it('rejects everything but an absolute https URL without credentials', () => {
    for (const url of [
      'http://example.com',
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ftp://example.com',
      'mailto:shop@example.com',
      '/shop',
      'shop',
      '//evil.example',
      'https://',
      'https://user:pass@example.com',
      'https://user@example.com',
      'https://:pass@example.com',
      '',
      '   ',
      `https://example.com/${NUL}`,
      `https://example.com/${'a'.repeat(500)}`,
    ]) {
      expect(parseUrl(url).success, url).toBe(false);
    }
  });

  it('caps the stored href, not just the typed text', () => {
    // Each Persian letter percent-encodes to six characters, and the href is what
    // is stored and re-parsed: 80 letters make a 500-character href, 81 do not fit.
    const typed = (letters: number) =>
      parseUrl(`https://example.com/${'ب'.repeat(letters)}`);
    expect(typed(80).success).toBe(true);
    // The URL is https, so the admin is told it is too long, not LINK_MESSAGES.url.
    expect(typed(81).error?.issues.map((issue) => issue.message)).toEqual([
      'مقدار واردشده بیش از حد طولانی است.',
    ]);
  });

  it('explains a rejected URL in Persian', () => {
    expect(parseUrl('http://example.com').error?.issues[0].message).toBe(
      LINK_MESSAGES.url,
    );
  });
});

describe('resolveLink', () => {
  const FALLBACK = '/fallback';

  it('falls back to the code destination when no link is saved', () => {
    expect(resolveLink(undefined, PATHS.ABOUT, targets)).toEqual({
      href: PATHS.ABOUT,
      external: false,
    });
    const petShop = shopPath({ pet: 'cat' });
    expect(resolveLink(null, petShop, targets)).toEqual({
      href: petShop,
      external: false,
    });
  });

  it('resolves each page to its path', () => {
    const page = (name: LinkPage) =>
      resolveLink({ type: 'page', page: name }, FALLBACK, targets);
    expect(page('home')).toEqual({ href: PATHS.HOME, external: false });
    expect(page('shop').href).toBe(PATHS.SHOP);
    expect(page('about').href).toBe(PATHS.ABOUT);
    expect(page('account').href).toBe(PATHS.ACCOUNT);
  });

  it('resolves a shop link to the category’s current slug and the pet', () => {
    expect(
      resolveLink(
        { type: 'shop', categoryId: CATEGORY_ID, pet: 'cat' },
        FALLBACK,
        targets,
      ),
    ).toEqual({
      href: shopPath({ category: 'dry-food', pet: 'cat' }),
      external: false,
    });
    expect(
      resolveLink({ type: 'shop', categoryId: CATEGORY_ID }, FALLBACK, targets)
        .href,
    ).toBe(shopPath({ category: 'dry-food' }));
    expect(
      resolveLink({ type: 'shop', pet: 'dog' }, FALLBACK, targets).href,
    ).toBe(shopPath({ pet: 'dog' }));
    expect(resolveLink({ type: 'shop' }, FALLBACK, targets).href).toBe(
      PATHS.SHOP,
    );
  });

  it('drops a deleted category but keeps the pet filter', () => {
    expect(
      resolveLink(
        { type: 'shop', categoryId: UNKNOWN_ID, pet: 'dog' },
        FALLBACK,
        targets,
      ).href,
    ).toBe(shopPath({ pet: 'dog' }));
    expect(
      resolveLink({ type: 'shop', categoryId: UNKNOWN_ID }, FALLBACK, targets)
        .href,
    ).toBe(PATHS.SHOP);
  });

  it('resolves an active product to its page, a deleted or hidden one to the shop', () => {
    expect(
      resolveLink(
        { type: 'product', productId: PRODUCT_ID },
        FALLBACK,
        targets,
      ),
    ).toEqual({
      href: productPath('royal-canin-cat-sensible-2kg'),
      external: false,
    });
    expect(
      resolveLink(
        { type: 'product', productId: UNKNOWN_ID },
        FALLBACK,
        targets,
      ),
    ).toEqual({ href: PATHS.SHOP, external: false });
  });

  it('marks an external link external and keeps its href', () => {
    expect(
      resolveLink(
        { type: 'external', url: 'https://example.com/guide' },
        FALLBACK,
        targets,
      ),
    ).toEqual({ href: 'https://example.com/guide', external: true });
  });
});

describe('collectLinkRefs', () => {
  it('lists every category and product id with the field path it sits on', () => {
    const value = {
      cta: 'x',
      ctaLink: { type: 'product', productId: PRODUCT_ID },
      cards: [
        { title: 'a', link: { type: 'shop', categoryId: CATEGORY_ID } },
        { title: 'b', link: null },
        { title: 'c', link: { type: 'shop', pet: 'dog' } },
        { title: 'd', link: { type: 'external', url: 'https://example.com/' } },
      ],
      slots: [
        { label: 'l', categoryIds: [CATEGORY_ID, OTHER_CATEGORY_ID] },
        { label: 'm' },
      ],
    };
    expect(collectLinkRefs(value)).toEqual([
      { path: 'ctaLink', kind: 'product', id: PRODUCT_ID },
      { path: 'cards.0.link', kind: 'category', id: CATEGORY_ID },
      { path: 'slots.0.categoryIds', kind: 'category', id: CATEGORY_ID },
      { path: 'slots.0.categoryIds', kind: 'category', id: OTHER_CATEGORY_ID },
    ]);
  });

  it('finds a link inside a list zipped with labels (footer columns)', () => {
    const value = {
      columns: [
        {
          title: 't',
          linkTargets: [null, { type: 'shop', categoryId: CATEGORY_ID }],
        },
      ],
    };
    expect(collectLinkRefs(value)).toEqual([
      { path: 'columns.0.linkTargets.1', kind: 'category', id: CATEGORY_ID },
    ]);
  });

  it('lists the «انتخاب‌های اسموکی» picks as cards, skipping the «خودکار» boxes', () => {
    // Not `product`: a link may point at any active product, a family member's
    // own page included, while a pick must be a card the shop lists.
    const value = {
      ...DEFAULT_CONTENT['home.recommends'],
      productIds: [null, PRODUCT_ID, null, UNKNOWN_ID],
    };
    expect(collectLinkRefs(value)).toEqual([
      { path: 'productIds', kind: 'card', id: PRODUCT_ID },
      { path: 'productIds', kind: 'card', id: UNKNOWN_ID },
    ]);
  });

  it('finds nothing in a block saved before links were editable', () => {
    expect(collectLinkRefs(DEFAULT_CONTENT['home.moments'])).toEqual([]);
    expect(collectLinkRefs(DEFAULT_CONTENT.footer)).toEqual([]);
    expect(collectLinkRefs(DEFAULT_CONTENT['home.recommends'])).toEqual([]);
  });
});
