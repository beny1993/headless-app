import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductForm, type ProductFormInitial } from './product-form';

const api = vi.hoisted(() => ({ putData: vi.fn() }));
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  putData: api.putData,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('product price preview', () => {
  for (const label of ['قیمت (تومان)', 'قیمت قبلی (اختیاری)']) {
    it(`keeps ${label} editable for an unsafe amount`, () => {
      render(<ProductForm categories={[]} />);
      const input = screen.getByLabelText(label) as HTMLInputElement;
      fireEvent.change(input, { target: { value: '9007199254740992' } });
      expect(input.value).toBe('9007199254740992');
      expect(screen.getByRole('button', { name: 'ذخیره محصول' })).toBeTruthy();
      fireEvent.change(input, { target: { value: '۱۲۳۴' } });
      expect(screen.getByText('۱٬۲۳۴ تومان')).toBeTruthy();
    });
  }
});

it('submits the observed inventory when editing a product', async () => {
  const product: ProductFormInitial = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'غذای گربه',
    slug: 'cat-food',
    sku: 'CAT-FOOD',
    brand: null,
    description: null,
    benefit: null,
    price: 100_000,
    oldPrice: null,
    stock: 5,
    categoryId: '123e4567-e89b-12d3-a456-426614174001',
    petType: 'cat',
    isActive: true,
    imageKey: null,
  };
  api.putData.mockResolvedValue({ id: product.id });
  render(
    <ProductForm
      product={product}
      categories={[{ id: product.categoryId, title: 'گربه' }]}
    />,
  );
  fireEvent.change(screen.getByLabelText('عنوان محصول'), {
    target: { value: 'عنوان تازه' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'ذخیره محصول' }));
  await waitFor(() =>
    expect(api.putData).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        title: 'عنوان تازه',
        stock: 5,
        expectedStock: 5,
      }),
    ),
  );
});
