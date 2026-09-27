// Which saved field feeds which link in each home and about section that carries
// one, rendered: a saved destination lands on its own button (an external one in
// a new tab), and an unset one keeps the destination the code had before links
// were editable. The resolution branches are `link.test.ts`, the loading of the
// targets the pages' integration tests; the pairing of field, fallback and button
// lives only in JSX, so — like the moments test — it earns a render.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AboutCta } from '@/features/storefront/about/about-sections';
import { PATHS, productPath, shopPath } from '@/lib/constant/paths';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import type { LinkTargets } from '@/lib/content/link';
import type { ContentValue } from '@/lib/content/site-content';
import { imageSrc } from '@/lib/storage/image-url';
import { CategoriesSection } from './categories';
import { FeaturedStorySection } from './featured-story';
import { HeroSection } from './hero';
import { PhilosophySection } from './philosophy';
import { RoutineSection } from './routine';

afterEach(cleanup);

const DRY_FOOD_ID = '0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b';
const TOYS_ID = '5f0c6a8e-3b1d-4c2a-9e7f-1a2b3c4d5e6f';
const DELETED_ID = '11111111-2222-4333-8444-555555555555';
const PRODUCT_ID = '9d8c7b6a-5f4e-4d3c-8b2a-0f1e2d3c4b5a';

const targets: LinkTargets = {
  categories: { [DRY_FOOD_ID]: 'dry-food', [TOYS_ID]: 'toys' },
  products: { [PRODUCT_ID]: 'cat-toy' },
};

/** The rendered <a> whose text contains `label`. */
const anchor = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('a')].find((a) =>
    a.textContent?.includes(label),
  );
const hrefOf = (container: HTMLElement, label: string) =>
  anchor(container, label)?.getAttribute('href');

describe('HeroSection buttons', () => {
  const content = DEFAULT_CONTENT['home.hero'];

  it('keep their code destinations until one is saved', () => {
    const { container } = render(
      <HeroSection content={content} targets={targets} />,
    );
    expect(hrefOf(container, content.shopCta)).toBe(shopPath());
    expect(hrefOf(container, content.aboutCta)).toBe(PATHS.ABOUT);
  });

  it('go where each saved destination says, an external one in a new tab', () => {
    const { container } = render(
      <HeroSection
        content={{
          ...content,
          shopCtaLink: { type: 'shop', categoryId: TOYS_ID, pet: 'cat' },
          aboutCtaLink: { type: 'external', url: 'https://example.com/story' },
        }}
        targets={targets}
      />,
    );
    expect(hrefOf(container, content.shopCta)).toBe(
      shopPath({ category: 'toys', pet: 'cat' }),
    );
    const about = anchor(container, content.aboutCta);
    expect(about?.getAttribute('href')).toBe('https://example.com/story');
    expect(about?.getAttribute('target')).toBe('_blank');
    expect(about?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('FeaturedStorySection button', () => {
  const content = DEFAULT_CONTENT['home.guide'];

  it('opens wet food until a destination is saved, then the saved product', () => {
    const { container, rerender } = render(
      <FeaturedStorySection content={content} targets={targets} />,
    );
    expect(hrefOf(container, content.cta)).toBe(
      shopPath({ category: 'wet-food' }),
    );

    rerender(
      <FeaturedStorySection
        content={{
          ...content,
          ctaLink: { type: 'product', productId: PRODUCT_ID },
        }}
        targets={targets}
      />,
    );
    expect(hrefOf(container, content.cta)).toBe(productPath('cat-toy'));
  });
});

describe('CategoriesSection all-categories link', () => {
  const content = DEFAULT_CONTENT['home.categories'];
  const tiles = [
    { id: TOYS_ID, title: 'اسباب‌بازی', slug: 'toys', imageKey: null },
  ];

  it('opens the bare shop until a destination is saved; the tiles stay category links', () => {
    const { container, rerender } = render(
      <CategoriesSection
        content={content}
        categories={tiles}
        targets={targets}
      />,
    );
    expect(hrefOf(container, content.cta)).toBe(shopPath());

    rerender(
      <CategoriesSection
        content={{ ...content, ctaLink: { type: 'page', page: 'about' } }}
        categories={tiles}
        targets={targets}
      />,
    );
    expect(hrefOf(container, content.cta)).toBe(PATHS.ABOUT);
    expect(hrefOf(container, 'اسباب‌بازی')).toBe(
      shopPath({ category: 'toys' }),
    );
  });

  // The mosaic is built for six tiles; a seventh category would break the
  // pattern rather than extend it, so the strip stops there.
  it('shows at most six tiles, the first six, however many categories there are', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      id: `${index}`,
      title: `دسته ${index}`,
      slug: `category-${index}`,
      imageKey: null,
    }));
    const { container } = render(
      <CategoriesSection
        content={content}
        categories={many}
        targets={targets}
      />,
    );

    const links = container.querySelectorAll(
      '[data-umami-event="home-category-click"]',
    );
    expect(links).toHaveLength(6);
    expect([...links].map((link) => link.getAttribute('href'))).toEqual(
      many.slice(0, 6).map((tile) => shopPath({ category: tile.slug })),
    );
  });
});

describe('CategoriesSection photos', () => {
  const PHOTO = 'uploads/123e4567-e89b-42d3-a456-426614174000.webp';

  it('draws each tile’s own photo from its key, and a plain surface without one', () => {
    // Production's case: an admin-made slug the demo data never had, with a
    // photo uploaded in the panel — and a demo slug with no key, which gets no
    // photo from anywhere, because the database is the only source.
    const { container } = render(
      <CategoriesSection
        content={DEFAULT_CONTENT['home.categories']}
        categories={[
          {
            id: TOYS_ID,
            title: 'اسباب بازی',
            slug: 'cat-toys',
            imageKey: PHOTO,
          },
          {
            id: DRY_FOOD_ID,
            title: 'غذای خشک',
            slug: 'dry-food',
            imageKey: null,
          },
        ]}
        targets={targets}
      />,
    );
    const photoOf = (label: string) =>
      anchor(container, label)?.querySelector('img');

    expect(
      decodeURIComponent(photoOf('اسباب بازی')?.getAttribute('src') ?? ''),
    ).toContain(`url=${imageSrc(PHOTO)}`);
    expect(photoOf('غذای خشک')).toBeNull();
  });
});

describe('PhilosophySection link', () => {
  const content = DEFAULT_CONTENT['home.philosophy'];

  it('opens /about until a destination is saved, then the saved pet shop', () => {
    const { container, rerender } = render(
      <PhilosophySection content={content} targets={targets} />,
    );
    expect(hrefOf(container, content.cta)).toBe(PATHS.ABOUT);

    rerender(
      <PhilosophySection
        content={{ ...content, ctaLink: { type: 'shop', pet: 'dog' } }}
        targets={targets}
      />,
    );
    expect(hrefOf(container, content.cta)).toBe(shopPath({ pet: 'dog' }));
  });
});

describe('AboutCta button', () => {
  const content = DEFAULT_CONTENT['about.cta'];

  it('opens the shop until a destination is saved; a deleted category keeps its pet', () => {
    const { container, rerender } = render(
      <AboutCta content={content} targets={targets} />,
    );
    expect(hrefOf(container, content.cta)).toBe(shopPath());

    rerender(
      <AboutCta
        content={{
          ...content,
          ctaLink: { type: 'shop', categoryId: DELETED_ID, pet: 'cat' },
        }}
        targets={targets}
      />,
    );
    expect(hrefOf(container, content.cta)).toBe(shopPath({ pet: 'cat' }));
  });
});

describe('RoutineSection tiles', () => {
  const content = DEFAULT_CONTENT['home.routine'];
  const categories = [
    { id: DRY_FOOD_ID, title: 'غذای خشک', slug: 'dry-food', imageKey: null },
    { id: TOYS_ID, title: 'اسباب‌بازی', slug: 'toys', imageKey: null },
  ];
  const tileHrefs = (container: HTMLElement) =>
    [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));

  it('shows the active tab’s code categories until categories are saved', () => {
    const { container } = render(
      <RoutineSection content={content} categories={categories} />,
    );
    // The first tab's code slugs: dry food.
    expect(tileHrefs(container)).toEqual([shopPath({ category: 'dry-food' })]);
  });

  it('shows the saved categories in the saved order, dropping a deleted one', () => {
    const slots = [...content.slots] as ContentValue<'home.routine'>['slots'];
    slots[0] = { ...slots[0], categoryIds: [TOYS_ID, DELETED_ID, DRY_FOOD_ID] };
    const { container } = render(
      <RoutineSection
        content={{ ...content, slots }}
        categories={categories}
      />,
    );
    expect(tileHrefs(container)).toEqual([
      shopPath({ category: 'toys' }),
      shopPath({ category: 'dry-food' }),
    ]);
  });
});
