// The storefront chrome's server data path: the (app) layout and the root
// not-found both read `header`/`footer` through `readSiteChrome` and hand typed
// props to `Navbar`/`Footer`. Needs a live database (see src/db/test-db.ts) —
// calling the layout exercises the real DAO and `resolveContent`.
//
// `connection()` is the one thing mocked, and only at the module edge: verified
// against Next 16.3.0, `connection()` THROWS `E251` ("called outside a request
// scope") in the vitest env, so the real runtime mechanism can't be driven from a
// test. Mocking `next/server`'s `connection` to resolve keeps the real
// `chrome.ts`/`getMany`/`resolveContent` under test while letting the read run.
// (The (app) pages don't call `connection()`, so their page.integration tests
// need no such mock.)
import { inArray } from 'drizzle-orm';
import Image from 'next/image';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { siteContent } from '@/db/schema/site-content';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import {
  FOOTER_TARGETS,
  NAV_TARGETS,
} from '@/features/storefront/layout/nav-links';
import { Footer } from '@/features/storefront/layout/footer';
import { Navbar } from '@/features/storefront/layout/navbar';

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: () => Promise.resolve(),
}));

const { SiteContentDao } = await importWithDb(
  () => import('@/db/dao/SiteContentDao'),
);
const layout = await importWithDb(() => import('./layout'));
const notFound = await importWithDb(() => import('@/app/not-found'));

type El = { type?: unknown; props?: Record<string, unknown> };
const isEl = (n: unknown): n is El =>
  typeof n === 'object' && n !== null && ('type' in n || 'props' in n);

/** Find the first element of the given component type anywhere in a tree. */
function findByType(node: unknown, type: unknown): El | undefined {
  if (!isEl(node)) return undefined;
  if (node.type === type) return node;
  const children = node.props?.children;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    const found = findByType(child, type);
    if (found) return found;
  }
  return undefined;
}

/** All the plain text under a node, joined — the label of a link. */
function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isEl(node)) return textOf(node.props?.children);
  return '';
}

/** Every `{ href, text }` link in a rendered subtree (next/link carries `href`). */
function collectLinks(
  node: unknown,
  out: { href: string; text: string }[] = [],
) {
  if (!isEl(node)) {
    if (Array.isArray(node)) node.forEach((c) => collectLinks(c, out));
    return out;
  }
  const href = node.props?.href;
  if (typeof href === 'string')
    out.push({ href, text: textOf(node.props?.children) });
  const children = node.props?.children;
  const list = Array.isArray(children) ? children : [children];
  list.forEach((c) => collectLinks(c, out));
  return out;
}

const hasLink = (subtree: unknown, href: string, label: string) =>
  collectLinks(subtree).some((l) => l.href === href && l.text.includes(label));

describe.skipIf(!databaseReachable)('the storefront chrome', () => {
  const clear = () =>
    testDb
      .delete(siteContent)
      .where(inArray(siteContent.key, ['header', 'footer']));

  beforeEach(clear);
  afterEach(clear);

  describe('with an empty site_content table', () => {
    it('passes the default header to Navbar and default footer to Footer', async () => {
      const tree = await layout.default({ children: null });
      const navbar = findByType(tree, Navbar);
      const footer = findByType(tree, Footer);
      expect(navbar?.props?.content).toEqual(DEFAULT_CONTENT.header);
      expect(footer?.props?.content).toEqual(DEFAULT_CONTENT.footer);
    });

    it('renders each nav label inside the <Link> with its own target (zip)', () => {
      // The misroute the rule prevents: label i must sit on target i. A one-off
      // zip would put «فروشگاه» on /about here.
      const rendered = Navbar({ content: DEFAULT_CONTENT.header });
      DEFAULT_CONTENT.header.nav.forEach((label, i) => {
        expect(hasLink(rendered, NAV_TARGETS[i], label), `nav ${i}`).toBe(true);
      });
    });

    it('derives meaningful Persian logo alt text from the editable brand', () => {
      const navbarLogo = findByType(
        Navbar({ content: DEFAULT_CONTENT.header }),
        Image,
      );
      const footerLogo = findByType(
        Footer({ content: DEFAULT_CONTENT.footer }),
        Image,
      );

      expect(navbarLogo?.props?.alt).toBe(
        `لوگوی ${DEFAULT_CONTENT.header.brand}`,
      );
      expect(footerLogo?.props?.alt).toBe(
        `لوگوی ${DEFAULT_CONTENT.footer.brand}، فروشگاه حیوانات خانگی`,
      );
    });

    it('renders each footer link label inside the <Link> with its own target (zip)', () => {
      const rendered = Footer({ content: DEFAULT_CONTENT.footer });
      DEFAULT_CONTENT.footer.columns.forEach((column, c) => {
        column.links.forEach((label, l) => {
          expect(
            hasLink(rendered, FOOTER_TARGETS[c][l], label),
            `footer ${c}.${l}`,
          ).toBe(true);
        });
      });
      // The one that actually differs: «درباره ما» lands on /about, not /shop.
      expect(hasLink(rendered, '/about', 'درباره ما')).toBe(true);
    });
  });

  describe('after an admin saves the header', () => {
    it('shows the new nav label on the very next render of the layout AND a 404', async () => {
      await SiteContentDao.set('header', {
        ...DEFAULT_CONTENT.header,
        nav: ['خانه', 'فروشگاه تازه', 'درباره ما'],
      });

      const layoutNav = findByType(
        await layout.default({ children: null }),
        Navbar,
      );
      expect((layoutNav?.props?.content as { nav: string[] }).nav[1]).toBe(
        'فروشگاه تازه',
      );

      const notFoundNav = findByType(await notFound.default(), Navbar);
      expect((notFoundNav?.props?.content as { nav: string[] }).nav[1]).toBe(
        'فروشگاه تازه',
      );

      // …and it renders on the correct target, not a stale one.
      expect(
        hasLink(
          Navbar(
            notFoundNav?.props as { content: typeof DEFAULT_CONTENT.header },
          ),
          '/shop',
          'فروشگاه تازه',
        ),
      ).toBe(true);
    });
  });

  describe('security: stored chrome is text, never markup', () => {
    it('renders a stored <script> brand as literal text with no dangerouslySetInnerHTML', async () => {
      await SiteContentDao.set('footer', {
        ...DEFAULT_CONTENT.footer,
        brand: '<script>alert(1)</script>',
      });

      const footer = findByType(
        await layout.default({ children: null }),
        Footer,
      );
      const rendered = Footer(
        footer?.props as { content: typeof DEFAULT_CONTENT.footer },
      );
      expect(textOf(rendered)).toContain('<script>alert(1)</script>');

      const nodes: El[] = [];
      const gather = (n: unknown) => {
        if (!isEl(n)) {
          if (Array.isArray(n)) n.forEach(gather);
          return;
        }
        nodes.push(n);
        const children = n.props?.children;
        (Array.isArray(children) ? children : [children]).forEach(gather);
      };
      gather(rendered);
      expect(
        nodes.filter((n) => n.props && 'dangerouslySetInnerHTML' in n.props),
      ).toHaveLength(0);
    });
  });
});
