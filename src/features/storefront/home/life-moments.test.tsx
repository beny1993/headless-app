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
// It renders on the happy-dom environment vitest already runs, like the two
// escapes CLAUDE.md points at; next/image renders a plain <img> there (the cart
// drawer's test relies on the same), so no mock is needed — the assertions are on
// the <a> hrefs and their text.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LifeMomentsSection } from './life-moments';
import { LIFE_MOMENT_TARGETS } from './content';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import { shopPath } from '@/lib/constant/paths';

afterEach(cleanup);

describe('LifeMomentsSection card links', () => {
  it('renders each card’s title/desc inside the <a> with that card’s own target', () => {
    const content = DEFAULT_CONTENT['home.moments'];
    const { container } = render(<LifeMomentsSection content={content} />);

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
    const { container } = render(<LifeMomentsSection content={content} />);
    const seeAll = [...container.querySelectorAll('a')].find((a) =>
      a.textContent?.includes(content.cta),
    );
    expect(seeAll?.getAttribute('href')).toBe(shopPath());
  });
});
