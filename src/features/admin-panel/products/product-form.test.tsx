import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api-client';
import {
  MAX_EXTRA_CATEGORIES,
  MAX_PRODUCT_IMAGES,
  PRODUCT_MESSAGES,
} from '@/lib/catalog/product-input';
import {
  apiAdminProductImagesPath,
  PROTECTED_PATHS,
} from '@/lib/constant/paths';
import { toPersianDigits } from '@/lib/format';
import { ProductForm, type ProductFormInitial } from './product-form';

/** The form's own fallback copy — not exported, so stated once here. */
const GENERIC_ERROR = 'خطای غیرمنتظره رخ داد. دوباره تلاش کن.';

const api = vi.hoisted(() => ({ putData: vi.fn() }));
const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
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
vi.mock('@sentry/nextjs', () => ({
  captureException: sentry.captureException,
}));
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
    extraCategoryIds: [],
    variantOf: null,
    variantLabel: null,
    isActive: true,
    images: [],
  };
  api.putData.mockResolvedValue({ id: product.id });
  render(
    <ProductForm
      product={product}
      categories={[{ id: product.categoryId, title: 'گربه', label: 'گربه' }]}
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
  extraCategoryIds: [],
  variantOf: null,
  variantLabel: null,
  isActive: true,
  images: [],
};

describe('product save failures', () => {
  const renderEdit = () =>
    render(
      <ProductForm
        product={EDIT_PRODUCT}
        categories={[
          { id: EDIT_PRODUCT.categoryId, title: 'گربه', label: 'گربه' },
        ]}
      />,
    );

  /** A POST /images answering with the envelope a refusal really sends. */
  const refusingUpload = (message: string, status = 400) =>
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: async () => ({ status: 'error', message }),
    });

  it('shows the server\u2019s own reason for a refused photo', async () => {
    // The generic advice is «retry from the product list». A stale-key refusal
    // says «refresh the page» — the opposite — and an admin following the
    // wrong one retries with the same stale keys forever.
    api.putData.mockResolvedValue({ id: EDIT_PRODUCT.id });
    vi.stubGlobal('fetch', refusingUpload(PRODUCT_MESSAGES.imagesMax));
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
        `محصول ذخیره شد اما ${toPersianDigits(1)} عکس بارگذاری نشد. ${PRODUCT_MESSAGES.imagesMax}`,
      ),
    );
  });

  it.each([
    ['a 500 the server could not explain', 500, 'Internal server error'],
    ['a refusal with no Persian sentence', 503, 'Service Unavailable'],
  ])('keeps the generic advice for %s', async (_name, status, message) => {
    // The hole the earlier test could not see: these arrive as a real
    // `ApiRequestError`, so «it came from the server» is not enough to put a
    // sentence in front of an admin. Only a 4xx carries one written for them.
    api.putData.mockResolvedValue({ id: EDIT_PRODUCT.id });
    vi.stubGlobal('fetch', refusingUpload(message, status));
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
        expect.stringContaining(
          'محصول را باز کن و عکس‌ها را دوباره انتخاب کن.',
        ),
      ),
    );
    expect(toast.warning).not.toHaveBeenCalledWith(
      expect.stringContaining(message),
    );
  });

  it('never puts the console-facing errors field in front of an admin', async () => {
    // `errors` is field paths and Zod's English text by documented contract.
    // A schema refusal sends both; only `message` is written for a person.
    api.putData.mockResolvedValue({ id: EDIT_PRODUCT.id });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          status: 'error',
          message: PRODUCT_MESSAGES.images,
          errors: ['objectKeys: Invalid input'],
        }),
      }),
    );
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
        expect.stringContaining(PRODUCT_MESSAGES.images),
      ),
    );
    expect(toast.warning).not.toHaveBeenCalledWith(
      expect.stringContaining('objectKeys'),
    );
  });

  it('keeps the generic advice when the connection simply died', async () => {
    // A dropped fetch is an `Error` whose message is technical English. It has
    // no business in Persian admin copy.
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
        expect.stringContaining(
          'محصول را باز کن و عکس‌ها را دوباره انتخاب کن.',
        ),
      ),
    );
    expect(toast.warning).not.toHaveBeenCalledWith(
      expect.stringContaining('offline'),
    );
  });

  it('says both when the photos and the order both fail', async () => {
    // One toast used to hide the other, though they say different things
    // about what to do next. Needs a saved photo to drop, so that the order
    // write fires at all.
    api.putData.mockImplementation(async (path: string) =>
      path.endsWith('/images')
        ? Promise.reject(new ApiRequestError(400, PRODUCT_MESSAGES.images))
        : { id: EDIT_PRODUCT.id },
    );
    vi.stubGlobal('fetch', refusingUpload('بارگذاری تصویر ناموفق بود.'));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    render(
      <ProductForm
        product={{
          ...EDIT_PRODUCT,
          images: [{ id: 'row-1', objectKey: 'uploads/old.jpg' }],
        }}
        categories={[
          { id: EDIT_PRODUCT.categoryId, title: 'گربه', label: 'گربه' },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'حذف عکس اصلی' }));
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: {
        files: [new File(['image'], 'cat.png', { type: 'image/png' })],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره محصول' }));

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringContaining('عکس بارگذاری نشد'),
      ),
    );
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining('ترتیب عکس‌ها ذخیره نشد'),
    );
  });

  // The three cases of one rule: a sentence the server wrote for a person
  // travels, anything else is replaced by Persian advice. Developer text used
  // to go straight into the toast — and the first of these pinned it as
  // correct by asserting the English `'server down'`.
  it('keeps a browser error out of the toast and stays on the form', async () => {
    // What a dead connection throws: `TypeError: Failed to fetch`, in English,
    // from the browser rather than from this app.
    api.putData.mockRejectedValue(new Error('server down'));
    renderEdit();

    fireEvent.click(screen.getByRole('button', { name: 'ذخیره محصول' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR),
    );
    expect(router.push).not.toHaveBeenCalled();
    // The admin reads the generic sentence, so this is the only record of what
    // actually happened: nothing reached the server, so nothing logged it there.
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'server down' }),
    );
  });

  it('keeps a 5xx placeholder out of the toast', async () => {
    // `create-router.ts` answers every 500 with this literal in production; it
    // is a placeholder standing in for details nobody outside may see, not a
    // sentence written for the admin reading the toast.
    api.putData.mockRejectedValue(
      new ApiRequestError(500, 'Internal server error'),
    );
    renderEdit();

    fireEvent.click(screen.getByRole('button', { name: 'ذخیره محصول' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR),
    );
    expect(router.push).not.toHaveBeenCalled();
    // Not reported from here: the request reached the server, so
    // `create-router.ts` captured it there. A second event would be one
    // failure filed twice.
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('shows the refusal a 4xx explained in Persian', async () => {
    // A 404 reaches this line rather than the field-mapping branch above (400,
    // 409 and 422 only), and it is the case that separates the rule from a
    // blanket generic: the server explained itself, for a person.
    api.putData.mockRejectedValue(new ApiRequestError(404, 'محصول یافت نشد'));
    renderEdit();

    fireEvent.click(screen.getByRole('button', { name: 'ذخیره محصول' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('محصول یافت نشد'),
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it('lands on the list with a warning toast when a photo fails after the save', async () => {
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

    // Counted, since a save can now carry several photos and lose only some.
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        `محصول ذخیره شد اما ${toPersianDigits(1)} عکس بارگذاری نشد. محصول را باز کن و عکس‌ها را دوباره انتخاب کن.`,
      ),
    );
    expect(router.push).toHaveBeenCalledWith(PROTECTED_PATHS.PRODUCTS);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('the gallery write order', () => {
  const GALLERY = Array.from({ length: MAX_PRODUCT_IMAGES }, (_, n) => ({
    id: `row-${n}`,
    objectKey: `uploads/photo-${n}.jpg`,
  }));

  it('drops the removed photos before uploading, so a swap at the cap fits', async () => {
    api.putData.mockResolvedValue({ id: EDIT_PRODUCT.id });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        data: { objectKey: 'uploads/new.jpg' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    render(
      <ProductForm
        product={{ ...EDIT_PRODUCT, images: GALLERY }}
        categories={[
          { id: EDIT_PRODUCT.categoryId, title: 'گربه', label: 'گربه' },
        ]}
      />,
    );

    // Swap one photo for another — the admin gesture the single-slot field
    // used to do in one pick. The add tile only exists once there is room.
    fireEvent.click(screen.getByRole('button', { name: 'حذف عکس اصلی' }));
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: {
        files: [new File(['image'], 'cat.png', { type: 'image/png' })],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره محصول' }));

    const imagesPath = apiAdminProductImagesPath(EDIT_PRODUCT.id);
    await waitFor(() =>
      expect(api.putData.mock.calls.some(([path]) => path === imagesPath)).toBe(
        true,
      ),
    );
    const order = api.putData.mock.calls.findIndex(
      ([path]) => path === imagesPath,
    );
    // The pin: the four kept keys are written FIRST, so the POST that follows
    // counts four stored photos and has room. Attach-then-order refuses the
    // upload against the five the server still holds and loses the new photo.
    expect(api.putData.mock.invocationCallOrder[order]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0],
    );
    expect(api.putData.mock.calls[order][1]).toEqual({
      objectKeys: GALLERY.slice(1).map((image) => image.objectKey),
    });
    // And the final order needs no second write: the upload appended exactly
    // where the admin left it.
    expect(
      api.putData.mock.calls.filter(([path]) => path === imagesPath),
    ).toHaveLength(1);
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(PROTECTED_PATHS.PRODUCTS),
    );
    expect(toast.warning).not.toHaveBeenCalled();
  });
});

describe('the additional categories', () => {
  const MAIN = EDIT_PRODUCT.categoryId;
  const MALT = '123e4567-e89b-12d3-a456-426614174002';
  const MULTI = '123e4567-e89b-12d3-a456-426614174003';

  /** The main category, a sub-category and one more — as the pages feed them. */
  const CATEGORIES = [
    { id: MAIN, title: 'مکمل', label: 'مکمل' },
    { id: MALT, title: 'مالت', label: '— مالت' },
    { id: MULTI, title: 'مولتی‌ویتامین', label: '— مولتی‌ویتامین' },
  ];

  const renderEdit = (product: Partial<ProductFormInitial> = {}) =>
    render(
      <ProductForm
        product={{ ...EDIT_PRODUCT, ...product }}
        categories={CATEGORIES}
      />,
    );

  const addSelect = () =>
    screen.getByLabelText('افزودن دسته‌بندی دیگر') as HTMLSelectElement;
  const mainSelect = () =>
    screen.getByLabelText('دسته‌بندی') as HTMLSelectElement;

  it('sends what was added, in the order it was added', async () => {
    api.putData.mockResolvedValue({ id: EDIT_PRODUCT.id });
    renderEdit();

    fireEvent.change(addSelect(), { target: { value: MULTI } });
    fireEvent.change(addSelect(), { target: { value: MALT } });
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره محصول' }));

    await waitFor(() =>
      expect(api.putData).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ extraCategoryIds: [MULTI, MALT] }),
      ),
    );
  });

  it('shows the saved ones as chips, by their plain title', () => {
    renderEdit({ extraCategoryIds: [MALT] });

    // No «— » prefix on a chip: that dash encodes depth inside a flat option
    // list, and a chip is not a list.
    expect(screen.getByText('مالت')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'حذف مالت از دسته‌بندی‌های دیگر' }),
    ).toBeTruthy();
    // …and the select no longer offers it, nor the main category.
    const offered = [...addSelect().options].map((option) => option.value);
    expect(offered).toEqual(['', MULTI]);
  });

  it('removes a chip, and offers its category again', () => {
    renderEdit({ extraCategoryIds: [MALT] });

    fireEvent.click(
      screen.getByRole('button', { name: 'حذف مالت از دسته‌بندی‌های دیگر' }),
    );

    expect(screen.queryByText('مالت')).toBeNull();
    expect([...addSelect().options].map((option) => option.value)).toEqual([
      '',
      MALT,
      MULTI,
    ]);
  });

  it('drops a chip the admin makes the main category, and says so', () => {
    renderEdit({ extraCategoryIds: [MALT, MULTI] });

    fireEvent.change(mainSelect(), { target: { value: MALT } });

    expect(
      screen.getByText(
        '«مالت» از دسته‌بندی‌های دیگر برداشته شد؛ حالا دسته‌بندی اصلی است.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /حذف مالت/ })).toBeNull();
    expect(screen.getByText('مولتی‌ویتامین')).toBeTruthy();
    // The note is about the change just made, so the next one clears it.
    fireEvent.change(addSelect(), { target: { value: MAIN } });
    expect(screen.queryByText(/برداشته شد/)).toBeNull();
  });

  it('disables the select at the cap and says why', () => {
    const many = Array.from(
      { length: MAX_EXTRA_CATEGORIES },
      (_unused, index) => `123e4567-e89b-12d3-a456-42661417400${index + 4}`,
    );
    renderEdit({ extraCategoryIds: many });

    expect(addSelect().disabled).toBe(true);
    expect(
      screen.getByText(
        `سقف ${toPersianDigits(MAX_EXTRA_CATEGORIES)} دسته‌بندی دیگر پر شده است؛ برای افزودن، یکی را حذف کن.`,
      ),
    ).toBeTruthy();
  });

  it('shows a refusal from the server in the fieldset’s own slot', async () => {
    // The route keys this on the bare field name so the fieldset can show it;
    // nothing else on the form would, and a toast is not raised while some
    // field owns the error. The wiring is `fieldErrors.extraCategoryIds` →
    // the `FieldMessage` the fieldset's `aria-describedby` points at, which no
    // unit test can reach.
    api.putData.mockRejectedValue(
      new ApiRequestError(400, 'محصول ذخیره نشد؛ ورودی را بررسی کن.', [
        `extraCategoryIds: ${PRODUCT_MESSAGES.extraCategories}`,
      ]),
    );
    renderEdit({ extraCategoryIds: [MALT] });

    fireEvent.click(screen.getByRole('button', { name: 'ذخیره محصول' }));

    const shown = await screen.findByText(PRODUCT_MESSAGES.extraCategories);
    // In the fieldset's slot, not loose on the page: the element the fieldset
    // names as its description is the one carrying the message.
    const fieldset = screen.getByRole('group', {
      name: 'دسته‌بندی‌های دیگر (اختیاری)',
    });
    expect(shown.id).toBe(fieldset.getAttribute('aria-describedby'));
    // …and the hint it replaced is gone, so the slot says one thing.
    expect(
      screen.queryByText(/اگر محصول در دسته‌بندی دیگری هم جا می‌گیرد/),
    ).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

/**
 * The two props this branch adds to the form. Neither is reachable from a unit
 * test — both decide whether a control is usable and what it says instead — and
 * one of them is the last door onto the bug that orphaned a family: refusing
 * the delete while leaving the visibility checkbox open sent the admin straight
 * round it.
 */
describe('a product family in the form', () => {
  const HEAD = '123e4567-e89b-12d3-a456-426614174010';
  const HEAD_CATEGORY = '123e4567-e89b-12d3-a456-426614174011';
  const renderMember = (
    props: Partial<Parameters<typeof ProductForm>[0]> = {},
  ) =>
    render(
      <ProductForm
        product={{
          ...EDIT_PRODUCT,
          variantOf: HEAD,
          variantLabel: '۵ کیلوگرم',
        }}
        categories={[
          { id: EDIT_PRODUCT.categoryId, title: 'گربه', label: 'گربه' },
        ]}
        variantHeads={[
          {
            id: HEAD,
            title: 'غذای خشک سگ',
            variantLabel: '۱۰ کیلوگرم',
            categoryId: HEAD_CATEGORY,
          },
        ]}
        {...props}
      />,
    );

  const headSelect = () =>
    screen.getByLabelText('زیرمجموعه‌ی (اختیاری)') as HTMLSelectElement;
  const visible = () =>
    screen.getByLabelText('نمایش در فروشگاه') as HTMLInputElement;

  it('offers each candidate head by its own «نوع»', () => {
    // The members of a family share one `title`, so a select that listed them
    // plainly would offer identical options.
    renderMember();

    expect(headSelect().value).toBe(HEAD);
    expect(screen.getByText('غذای خشک سگ — ۱۰ کیلوگرم')).toBeTruthy();
  });

  it('offers a head with no «نوع» of its own, but refuses it', () => {
    // Shown and disabled, with the reason: a head missing from the list is a
    // head the admin cannot work out how to use.
    renderMember({
      variantHeads: [
        {
          id: HEAD,
          title: 'غذای خشک سگ',
          variantLabel: null,
          categoryId: HEAD_CATEGORY,
        },
      ],
    });

    const option = screen.getByText(
      'غذای خشک سگ (اول «نوع» آن را پر کن)',
    ) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
  });

  it('offers a member no filing controls of its own, and says why', () => {
    renderMember();

    // The shop lists heads, so a member's own categories could never
    // reach a shelf. Offering the fields was offering a filing that did
    // nothing; the family is filed once, on the head.
    expect(screen.queryByLabelText('دسته‌بندی')).toBeNull();
    expect(screen.queryByText('دسته‌بندی‌های دیگر (اختیاری)')).toBeNull();
    expect(screen.getByText(/از محصول اصلی گرفته می‌شود/)).toBeTruthy();
  });

  it('keeps them for a product that stands alone', () => {
    renderMember({ product: { ...EDIT_PRODUCT, variantOf: null } });

    expect(screen.getByLabelText('دسته‌بندی')).toBeTruthy();
    expect(screen.getByText('دسته‌بندی‌های دیگر (اختیاری)')).toBeTruthy();
  });

  it('takes the head’s filing when one is picked', () => {
    // A new member has no filing of its own to send, and the body still has to
    // satisfy the same schema as any other product — so picking the head fills
    // those fields rather than leaving the save to fail on a hidden one.
    render(
      <ProductForm
        categories={[
          { id: EDIT_PRODUCT.categoryId, title: 'گربه', label: 'گربه' },
          { id: HEAD_CATEGORY, title: 'سگ', label: 'سگ' },
        ]}
        variantHeads={[
          {
            id: HEAD,
            title: 'غذای خشک سگ',
            variantLabel: '۱۰ کیلوگرم',
            categoryId: HEAD_CATEGORY,
          },
        ]}
      />,
    );

    expect(screen.getByLabelText('دسته‌بندی')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('زیرمجموعه‌ی (اختیاری)'), {
      target: { value: HEAD },
    });

    expect(screen.queryByLabelText('دسته‌بندی')).toBeNull();
    expect(screen.getByText(/از محصول اصلی گرفته می‌شود/)).toBeTruthy();
  });

  it('closes both doors on a head that already has members', () => {
    renderMember({
      product: { ...EDIT_PRODUCT, variantLabel: '۵ کیلوگرم' },
      hasMembers: true,
    });

    // The select, because only one level is allowed — and the checkbox,
    // because hiding a head hides a family the shop then lists nowhere while
    // its members stay live. The DAO refuses both; the form must not offer
    // them and then explain afterwards.
    expect(headSelect().disabled).toBe(true);
    expect(visible().disabled).toBe(true);
    expect(
      screen.getByText(
        'این محصول خودش زیرمجموعه دارد، پس نمی‌تواند زیرمجموعه‌ی محصول دیگری باشد.',
      ),
    ).toBeTruthy();
  });

  it('leaves both open on an ordinary product', () => {
    render(
      <ProductForm
        product={EDIT_PRODUCT}
        categories={[
          { id: EDIT_PRODUCT.categoryId, title: 'گربه', label: 'گربه' },
        ]}
      />,
    );

    expect(headSelect().disabled).toBe(false);
    expect(visible().disabled).toBe(false);
  });
});
