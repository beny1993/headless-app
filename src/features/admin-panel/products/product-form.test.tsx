import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRODUCT_MESSAGES } from '@/lib/catalog/product-input';
import { PROTECTED_PATHS } from '@/lib/constant/paths';
import { ProductForm, type ProductFormInitial } from './product-form';

const api = vi.hoisted(() => ({ putData: vi.fn() }));
const { router, toast } = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn() },
  toast: { error: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  putData: api.putData,
}));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('sonner', () => ({ toast }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
    petTypes: ['cat'],
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
  const sku = screen.getByLabelText('کد کالا (SKU)') as HTMLInputElement;
  expect(sku.readOnly).toBe(true);
  expect(sku.value).toBe('CAT-FOOD');
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
  expect(api.putData.mock.calls[0][1]).not.toHaveProperty('sku');
});

it('previews a read-only SKU from the slug while creating', () => {
  render(<ProductForm categories={[]} />);
  const sku = screen.getByLabelText('کد کالا (SKU)') as HTMLInputElement;
  expect(sku.readOnly).toBe(true);
  expect(sku.value).toBe('');
  fireEvent.change(screen.getByLabelText('نشانی یکتا (slug)'), {
    target: { value: 'royal-canin' },
  });
  expect(sku.value).toBe('ROYAL-CANIN-????');
});

const EDIT_PRODUCT: ProductFormInitial = {
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
  petTypes: ['cat'],
  isActive: true,
  imageKey: null,
};

describe('product save failures', () => {
  const renderEdit = () =>
    render(
      <ProductForm
        product={EDIT_PRODUCT}
        categories={[{ id: EDIT_PRODUCT.categoryId, title: 'گربه' }]}
      />,
    );

  it('reports a failed save as an error toast and stays on the form', async () => {
    api.putData.mockRejectedValue(new Error('server down'));
    renderEdit();

    fireEvent.click(screen.getByRole('button', { name: 'ذخیره محصول' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('server down'),
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it('lands on the list with a warning toast when the photo fails after the save', async () => {
    api.putData.mockResolvedValue({ id: EDIT_PRODUCT.id });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    renderEdit();

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: {
        files: [new File(['image'], 'cat.png', { type: 'image/png' })],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره محصول' }));

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        'محصول ذخیره شد اما بارگذاری تصویر ناموفق بود. از فهرست محصولات دوباره تلاش کن.',
      ),
    );
    expect(router.push).toHaveBeenCalledWith(PROTECTED_PATHS.PRODUCTS);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('the pet control', () => {
  // The buttons carry an emoji before the word, so they are matched by it.
  const pet = (name: RegExp) => screen.getByRole('button', { name });

  it('starts a new product with neither pet pressed', () => {
    // Not «گربه» by default: with toggle semantics a pre-pressed cat turns an
    // admin who presses only «سگ» into a silent both-pets product.
    render(<ProductForm categories={[]} />);

    expect(pet(/گربه/).getAttribute('aria-pressed')).toBe('false');
    expect(pet(/سگ/).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('یکی یا هر دو را انتخاب کن')).toBeTruthy();
  });

  it('shows the saved selection when editing', () => {
    render(
      <ProductForm
        product={{ ...EDIT_PRODUCT, petTypes: ['cat', 'dog'] }}
        categories={[{ id: EDIT_PRODUCT.categoryId, title: 'گربه' }]}
      />,
    );

    expect(pet(/گربه/).getAttribute('aria-pressed')).toBe('true');
    expect(pet(/سگ/).getAttribute('aria-pressed')).toBe('true');
  });

  it('toggles each pet independently and sends both', async () => {
    api.putData.mockResolvedValue({ id: EDIT_PRODUCT.id });
    render(
      <ProductForm
        product={EDIT_PRODUCT}
        categories={[{ id: EDIT_PRODUCT.categoryId, title: 'گربه' }]}
      />,
    );

    fireEvent.click(pet(/سگ/));

    expect(pet(/گربه/).getAttribute('aria-pressed')).toBe('true');
    expect(pet(/سگ/).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره محصول' }));
    await waitFor(() =>
      expect(api.putData).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ petTypes: ['cat', 'dog'] }),
      ),
    );
  });

  it('refuses a save with no pet and sends nothing', async () => {
    render(
      <ProductForm
        product={EDIT_PRODUCT}
        categories={[{ id: EDIT_PRODUCT.categoryId, title: 'گربه' }]}
      />,
    );

    fireEvent.click(pet(/گربه/));
    expect(pet(/گربه/).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره محصول' }));

    await waitFor(() =>
      expect(screen.getByText(PRODUCT_MESSAGES.petRequired)).toBeTruthy(),
    );
    expect(api.putData).not.toHaveBeenCalled();
    // Pressing a pet again clears the message, as every other field does.
    fireEvent.click(pet(/سگ/));
    expect(screen.queryByText(PRODUCT_MESSAGES.petRequired)).toBeNull();
  });
});
