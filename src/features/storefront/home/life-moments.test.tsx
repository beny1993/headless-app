// Pins the life-moment cards' label↔target zip: card i's editable title/desc must
// render inside the `<Link>` whose href is `LIFE_MOMENT_TARGETS[i]`'s shop filter.
//
// Why a component test and not a unit test (per CLAUDE.md's "wiring, not a
// function" bar): the pairing lives only in JSX — `content.cards[i]` indexed
// against `LIFE_MOMENT_TARGETS[i]` inside a `.map`. No pure function to call; the
// parity unit test (content.test.ts) proves the lengths match, but only a render
// shows label i actually landing on target i. This is the exact misroute the v2
// "a label travels with its target" rule exists to prevent (the story names it),
// so it earns a render test. Revert the zip (index → index+1) and this fails.
//
// Destinations became content too (`card.link`, `ctaLink`): a saved one wins and
// an unset one keeps the code target, and a saved card wears its destination's
// pet — both halves are pinned below.
//
// It renders on the happy-dom environment vitest already runs, like the two
// escapes CLAUDE.md points at; next/image renders a plain <img> there (the cart
// drawer's test relies on the same), so no mock is needed — the assertions are on
// the <a> hrefs and their text.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LifeMomentsSection } from './life-moments';
import { LIFE_MOMENT_TARGETS } from './content';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import { PATHS, shopPath } from '@/lib/constant/paths';
import type { LinkTargets } from '@/lib/content/link';
import type { ContentValue } from '@/lib/content/site-content';
import { SEED_CATEGORIES } from '@/db/seed/catalog-data';

afterEach(cleanup);

const NO_TARGETS: LinkTargets = { categories: {}, products: {} };
const SEED_SLUGS = SEED_CATEGORIES.map((row) => row.slug);
const TREATS_ID = '7e6d5c4b-3a2f-4e1d-9c0b-a9f8e7d6c5b4';

describe('LifeMomentsSection card links', () => {
  it('narrows a card with no saved destination to its pet when the catalogue lacks its category', () => {
    const content = DEFAULT_CONTENT['home.moments'];
    const { container } = render(
      <LifeMomentsSection
        content={content}
        targets={NO_TARGETS}
        categorySlugs={[]}
      />,
    );

    const anchors = [...container.querySelectorAll('a')];
    content.cards.forEach((card, i) => {
      const anchor = anchors.find((a) => a.textContent?.includes(card.title));
      expect(anchor?.getAttribute('href'), `card ${i}`).toBe(
        shopPath({ pet: LIFE_MOMENT_TARGETS[i].filters.pet }),
      );
    });
  });

  it('renders each card’s title/desc inside the <a> with that card’s own target', () => {
    const content = DEFAULT_CONTENT['home.moments'];
    const { container } = render(
      <LifeMomentsSection
        content={content}
        targets={NO_TARGETS}
        categorySlugs={SEED_SLUGS}
      />,
    );

    const anchors = [...container.querySelectorAll('a')];
    content.cards.forEach((card, i) => {
      const href = shopPath(LIFE_MOMENT_TARGETS[i].filters);
      const anchor = anchors.find((a) => a.getAttribute('href') === href);
      expect(anchor, `link for card ${i} (${href})`).toBeTruthy();
      // The label at index i sits on the target at index i — not a neighbour's.
      expect(anchor?.textContent).toContain(card.title);
      expect(anchor?.textContent).toContain(card.desc);
    });
  });

  it('renders the «مشاهده همه» label on the bare shop link', () => {
    const content = DEFAULT_CONTENT['home.moments'];
    const { container } = render(
      <LifeMomentsSection
        content={content}
        targets={NO_TARGETS}
        categorySlugs={SEED_SLUGS}
      />,
    );
    const seeAll = [...container.querySelectorAll('a')].find((a) =>
      a.textContent?.includes(content.cta),
    );
    expect(seeAll?.getAttribute('href')).toBe(shopPath());
  });

  it('sends a card with a saved destination there, wearing that destination’s pet', () => {
    const content = DEFAULT_CONTENT['home.moments'];
    const cards = [...content.cards] as ContentValue<'home.moments'>['cards'];
    cards[0] = {
      ...cards[0],
      link: { type: 'shop', categoryId: TREATS_ID, pet: 'dog' },
    };
    cards[1] = {
      ...cards[1],
      link: { type: 'external', url: 'https://example.com/play' },
    };
    const { container } = render(
      <LifeMomentsSection
        content={{ ...content, cards }}
        targets={{ categories: { [TREATS_ID]: 'treats' }, products: {} }}
        categorySlugs={SEED_SLUGS}
      />,
    );
    const anchors = [...container.querySelectorAll('a')];
    const card = (i: number) =>
      anchors.find((a) => a.textContent?.includes(cards[i].title));

    expect(card(0)?.getAttribute('href')).toBe(
      shopPath({ category: 'treats', pet: 'dog' }),
    );
    expect(card(0)?.textContent).toContain('🐶');
    expect(card(1)?.getAttribute('href')).toBe('https://example.com/play');
    expect(card(1)?.getAttribute('target')).toBe('_blank');
    expect(card(1)?.textContent).toContain('🐾');
    // Card 2 saved nothing: its code destination and emoji.
    expect(card(2)?.getAttribute('href')).toBe(
      shopPath(LIFE_MOMENT_TARGETS[2].filters),
    );
    expect(card(2)?.textContent).toContain(LIFE_MOMENT_TARGETS[2].emoji);
  });

  it('sends «مشاهده همه» to its saved destination', () => {
    const content = {
      ...DEFAULT_CONTENT['home.moments'],
      ctaLink: { type: 'page', page: 'about' } as const,
    };
    const { container } = render(
      <LifeMomentsSection
        content={content}
        targets={NO_TARGETS}
        categorySlugs={SEED_SLUGS}
      />,
    );
    const seeAll = [...container.querySelectorAll('a')].find((a) =>
      a.textContent?.includes(content.cta),
    );
    expect(seeAll?.getAttribute('href')).toBe(PATHS.ABOUT);
  });
});
