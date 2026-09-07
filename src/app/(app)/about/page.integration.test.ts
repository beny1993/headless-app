// The About page's server data path. Needs a live database — see src/db/test-db.ts.
//
// The page is an async server component, so it is called directly and its
// returned element tree inspected: no renderer, no component-test infrastructure
// (the repo has none). The assertions stay on behaviour the story asks for —
// an empty table renders today's copy, a saved block shows on the next load,
// stored markup renders as literal text (never as HTML), and an invalid row
// falls back to the default.
//
// The five about keys are cleared in beforeEach AND afterEach: the storefront
// and the admin editor share this table on the shared dev database, so a crashed
// prior run must not leak a row into the "empty table" case.
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { siteContent } from '@/db/schema/site-content';
import { databaseReachable, importWithDb, testDb } from '@/db/test-db';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';

const { SiteContentDao } = await importWithDb(
  () => import('@/db/dao/SiteContentDao'),
);
const page = await importWithDb(() => import('./page'));

const ABOUT_KEYS = [
  'about.hero',
  'about.story',
  'about.process',
  'about.values',
  'about.cta',
] as const;

/**
 * Shallow-render a returned element tree and collect every string in it — text,
 * `href`, `alt`, `src`, class names — while visiting every node so a structural
 * check can run over the same walk.
 *
 * The About sections are hook-free synchronous server components that the page
 * composes but does not itself invoke, so imageSrc, the `pre-line` classes and
 * the `.map`s only run when those components are called. This invokes them: on a
 * function-typed element it calls `type(props)` and recurses into the result.
 * `next/image` needs React context and throws when invoked bare — that is caught
 * and its props are walked instead, so the resolved `src` (imageSrc's output,
 * computed by the parent section) is still collected.
 */
function walk(
  node: unknown,
  onNode: (node: Record<string, unknown>) => void,
  strings: string[] = [],
): string[] {
  if (typeof node === 'string' || typeof node === 'number') {
    strings.push(String(node));
    return strings;
  }
  if (Array.isArray(node)) {
    for (const child of node) walk(child, onNode, strings);
    return strings;
  }
  if (typeof node !== 'object' || node === null) return strings;

  onNode(node as Record<string, unknown>);
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  const props = el.props;

  if (typeof el.type === 'function') {
    try {
      walk((el.type as (p: unknown) => unknown)(props ?? {}), onNode, strings);
      return strings;
    } catch {
      // A component that cannot be invoked outside a real render (next/image):
      // fall through to walking its props, which still carry src/alt.
    }
  }

  for (const value of Object.values(props ?? (node as Record<string, unknown>)))
    walk(value, onNode, strings);
  return strings;
}

const inspect = async () => {
  const nodes: Record<string, unknown>[] = [];
  const strings = walk(await page.default(), (n) => nodes.push(n));
  return { nodes, strings, text: strings.join(' ') };
};

describe.skipIf(!databaseReachable)('the About page', () => {
  const clear = () =>
    testDb.delete(siteContent).where(inArray(siteContent.key, [...ABOUT_KEYS]));

  beforeEach(clear);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clear();
  });

  describe('with an empty site_content table', () => {
    it('renders the default About copy, including the Smokey story caption + alt', async () => {
      const { strings, text } = await inspect();

      // Hero + story + process + values + cta defaults all present.
      expect(strings).toContain(DEFAULT_CONTENT['about.hero'].eyebrow);
      expect(strings).toContain(DEFAULT_CONTENT['about.story'].title); // «این اسموکی‌ه»
      expect(strings).toContain(DEFAULT_CONTENT['about.story'].image.alt);
      expect(strings).toContain(DEFAULT_CONTENT['about.process'].title);
      expect(strings).toContain(DEFAULT_CONTENT['about.values'].title);
      expect(strings).toContain(DEFAULT_CONTENT['about.cta'].headline);
      // The first story paragraph renders in full.
      expect(text).toContain(DEFAULT_CONTENT['about.story'].paragraphs[0]);
    });

    it('resolves the About-hero image to a root-relative bundled URL', async () => {
      const { strings } = await inspect();
      // imageSrc turns the slash-less key into a `/`-prefixed public URL.
      expect(strings).toContain(`/${DEFAULT_CONTENT['about.hero'].image.key}`);
    });
  });

  describe('after an admin saves a block', () => {
    it('shows the new value on the very next load (no cache to go stale)', async () => {
      await SiteContentDao.set('about.cta', {
        ...DEFAULT_CONTENT['about.cta'],
        headline: 'سلام تازه‌وارد',
      });

      const { strings } = await inspect();
      expect(strings).toContain('سلام تازه‌وارد');
      expect(strings).not.toContain(DEFAULT_CONTENT['about.cta'].headline);
    });

    it('makes the Smokey identity fixable end to end (title, alt and photo)', async () => {
      await SiteContentDao.set('about.story', {
        title: 'این واقعاً اسموکی است',
        paragraphs: DEFAULT_CONTENT['about.story'].paragraphs,
        image: {
          key: 'site/hero-about.jpg',
          alt: 'اسموکی، با توضیح تازه',
        },
      });

      const { strings } = await inspect();
      expect(strings).toContain('این واقعاً اسموکی است');
      expect(strings).toContain('اسموکی، با توضیح تازه');
      expect(strings).toContain('/site/hero-about.jpg');
    });
  });

  describe('section visibility', () => {
    it('omits a section the admin has hidden, and keeps its siblings', async () => {
      await SiteContentDao.set('about.process', {
        ...DEFAULT_CONTENT['about.process'],
        visible: false,
      });

      const { strings } = await inspect();
      // The hidden process section's copy is gone…
      expect(strings).not.toContain(DEFAULT_CONTENT['about.process'].title);
      // …while an untouched sibling still renders.
      expect(strings).toContain(DEFAULT_CONTENT['about.hero'].eyebrow);
    });
  });

  describe('security: stored content is text, never markup', () => {
    it('renders a stored <script> as literal text and adds no dangerouslySetInnerHTML', async () => {
      await SiteContentDao.set('about.story', {
        title: '<script>alert(1)</script>',
        paragraphs: ['<b>x</b>', 'دو', 'سه'],
        image: DEFAULT_CONTENT['about.story'].image,
      });

      const { strings, nodes } = await inspect();

      // The markup appears verbatim as a text node…
      expect(strings).toContain('<script>alert(1)</script>');
      expect(strings).toContain('<b>x</b>');
      // …and NOTHING in the tree renders raw HTML.
      const withRawHtml = nodes.filter(
        (n) =>
          n.props &&
          'dangerouslySetInnerHTML' in (n.props as Record<string, unknown>),
      );
      expect(withRawHtml).toHaveLength(0);
    });
  });

  describe('a schema-invalid row', () => {
    it('falls back to the default rather than breaking the page', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // A row hand-edited outside the app to carry an off-shape image key.
      await testDb.insert(siteContent).values({
        key: 'about.hero',
        value: {
          ...DEFAULT_CONTENT['about.hero'],
          image: { key: 'https://evil.example/x.jpg', alt: 'x' },
        },
      });

      const { strings } = await inspect();
      // The default hero copy renders; the bad URL never reaches the page.
      expect(strings).toContain(DEFAULT_CONTENT['about.hero'].eyebrow);
      expect(strings).toContain(`/${DEFAULT_CONTENT['about.hero'].image.key}`);
      expect(strings.join(' ')).not.toContain('evil.example');
      expect(warn).toHaveBeenCalled();
    });
  });
});
