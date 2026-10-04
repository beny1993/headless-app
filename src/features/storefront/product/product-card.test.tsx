import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProductCard } from './product-card';
import type { ProductCard as ProductCardRow } from '@/db/schema/catalog';
import { formatToman } from '@/lib/format';
import { productPath } from '@/lib/constant/paths';

const standalone: ProductCardRow = {
  id: 'product-id',
  title: 'غذای گربه',
  slug: 'cat-food',
  sku: 'CAT-FOOD',
  brand: null,
  description: null,
  benefit: null,
  searchText: '',
  price: 185_000,
  oldPrice: 210_000,
  stock: 0,
  isActive: true,
  categoryId: 'category-id',
  petTypes: ['cat'],
  variantOf: null,
  variantLabel: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  images: [],
  extraCategoryIds: [],
  familyMinPrice: 185_000,
  familyPricesVary: false,
  familyInStock: false,
  familyHasMembers: false,
  familyOpenSlug: 'cat-food',
};

afterEach(cleanup);

describe('ProductCard price visibility', () => {
  it('hides both prices for an unavailable shop product while retaining its status and link', () => {
    const { container, getByRole, getByText } = render(
      <ProductCard product={standalone} hideUnavailablePrice />,
    );

    expect(container.textContent).not.toContain('تومان');
    expect(container.textContent).not.toContain(formatToman(standalone.price));
    expect(container.textContent).not.toContain(
      formatToman(standalone.oldPrice!),
    );
    expect(getByText('ناموجود')).toBeTruthy();
    expect(
      getByRole('img', { name: `${standalone.title} ناموجود است` }),
    ).toBeTruthy();
    expect(
      getByRole('link', { name: standalone.title }).getAttribute('href'),
    ).toBe(productPath(standalone.slug));
    expect(container.querySelector('button')).toBeNull();
  });

  it.each([false, true])(
    'hides every price for a sold-out family with varying prices=%s',
    (familyPricesVary) => {
      const product = {
        ...standalone,
        familyHasMembers: true,
        familyPricesVary,
      };
      const { container, getByRole, getByText } = render(
        <ProductCard product={product} hideUnavailablePrice />,
      );

      expect(container.textContent).not.toContain('تومان');
      expect(container.textContent).not.toMatch(/از\s/);
      expect(getByText('ناموجود')).toBeTruthy();
      expect(
        getByRole('link', { name: `انتخاب ${product.title}` }).getAttribute(
          'href',
        ),
      ).toBe(productPath(product.slug));
    },
  );

  it('shows the buyable family price and opens the sibling even when its head is sold out', () => {
    const product = {
      ...standalone,
      familyHasMembers: true,
      familyInStock: true,
      familyPricesVary: true,
      familyMinPrice: 225_000,
      familyOpenSlug: 'cat-food-large',
    };
    const { container, getByRole, queryByText } = render(
      <ProductCard product={product} hideUnavailablePrice />,
    );

    expect(container.textContent).toContain(
      `از ${formatToman(product.familyMinPrice)}`,
    );
    expect(container.textContent).not.toContain(formatToman(product.price));
    expect(container.textContent).not.toContain(formatToman(product.oldPrice!));
    expect(queryByText('ناموجود')).toBeNull();
    expect(
      getByRole('link', { name: `انتخاب ${product.title}` }).getAttribute(
        'href',
      ),
    ).toBe(productPath(product.familyOpenSlug));
  });

  it('shows a stocked standalone product’s current price, previous price and add action', () => {
    const product = { ...standalone, stock: 4, familyInStock: true };
    const { container, getByRole, getByText } = render(
      <ProductCard product={product} hideUnavailablePrice />,
    );

    expect(container.textContent).toContain(formatToman(product.price));
    expect(container.textContent).toContain(formatToman(product.oldPrice!));
    expect(getByText('تخفیف')).toBeTruthy();
    expect(
      getByRole('button', { name: `افزودن ${product.title} به سبد خرید` }),
    ).toBeTruthy();
  });

  it.each([true, false])(
    'uses availability rather than a zero price to decide visibility (in stock=%s)',
    (familyInStock) => {
      const product = {
        ...standalone,
        price: 0,
        oldPrice: null,
        familyMinPrice: 0,
        familyInStock,
      };
      const { container } = render(
        <ProductCard product={product} hideUnavailablePrice />,
      );

      expect(container.textContent?.includes(formatToman(0))).toBe(
        familyInStock,
      );
    },
  );

  it('preserves the homepage default for an unavailable standalone product', () => {
    const { container } = render(<ProductCard product={standalone} />);

    expect(container.textContent).toContain(formatToman(standalone.price));
    expect(container.textContent).toContain(formatToman(standalone.oldPrice!));
  });

  it('preserves the homepage default for an unavailable family', () => {
    const product = {
      ...standalone,
      familyHasMembers: true,
      familyPricesVary: true,
    };
    const { container } = render(<ProductCard product={product} />);

    expect(container.textContent).toContain(
      `از ${formatToman(product.familyMinPrice)}`,
    );
  });
});
