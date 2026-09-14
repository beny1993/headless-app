import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BLOCK_FIELDS } from './block-fields';
import { ContentEditor } from './content-editor';
import { LINK_PICKER_LABELS, type LinkOptions } from './link-picker';
import { ApiRequestError } from '@/lib/api-client';
import {
  apiAdminContentPath,
  PATHS,
  productPath,
  shopPath,
} from '@/lib/constant/paths';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';
import { LINK_MESSAGES } from '@/lib/content/link';
import type { ContentKey } from '@/lib/content/site-content';

const DRY = {
  id: '0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b',
  title: 'غذای خشک',
  slug: 'dry-food',
};
const TOYS = {
  id: '5f0c6a8e-3b1d-4c2a-9e7f-1a2b3c4d5e6f',
  title: 'اسباب‌بازی',
  slug: 'toys',
};
/** A category or product id the catalog no longer has. */
const DELETED_ID = '11111111-2222-4333-8444-555555555555';
const OPTIONS: LinkOptions = {
  categories: [DRY, TOYS],
  products: [
    {
      id: '9d8c7b6a-5f4e-4d3c-8b2a-0f1e2d3c4b5a',
      title: 'توپ گربه',
      slug: 'cat-ball',
    },
  ],
};

const { putData, toast } = vi.hoisted(() => ({
  putData: vi.fn(),
  toast: { error: vi.fn() },
}));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  putData,
}));
vi.mock('sonner', () => ({ toast }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('content editor save boundary', () => {
  it('unlocks image and text fields after an upload failure and permits retry', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('upload failed'));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    render(
      <ContentEditor
        options={OPTIONS}
        keys={['home.hero']}
        values={{ 'home.hero': DEFAULT_CONTENT['home.hero'] }}
      />,
    );
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: {
        files: [new File(['image'], 'cat.png', { type: 'image/png' })],
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
    });
    expect(toast.error).toHaveBeenCalledWith('upload failed');
    expect(putData).not.toHaveBeenCalled();
    expect(document.querySelector('fieldset')?.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  for (const succeeds of [true, false]) {
    it(`locks edits while saving and unlocks after ${succeeds ? 'success' : 'failure'}`, async () => {
      let finish!: (value: unknown) => void;
      let fail!: (reason: Error) => void;
      putData.mockReturnValue(
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
      );
      render(
        <ContentEditor
          options={OPTIONS}
          keys={['home.philosophy']}
          values={{ 'home.philosophy': DEFAULT_CONTENT['home.philosophy'] }}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
      fireEvent.submit(document.querySelector('form')!);
      expect(putData).toHaveBeenCalledOnce();
      const fields = Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          'input, textarea',
        ),
      );
      expect(fields.length).toBeGreaterThan(0);
      // A native disabled fieldset locks text, visibility and image controls.
      expect(
        fields.every((field) => field.closest('fieldset')?.disabled === true),
      ).toBe(true);
      await act(async () => {
        if (succeeds)
          finish({
            key: 'home.philosophy',
            value: DEFAULT_CONTENT['home.philosophy'],
          });
        else fail(new Error('save failed'));
      });
      expect(
        fields.every((field) => field.closest('fieldset')?.disabled === false),
      ).toBe(true);
      if (!succeeds) expect(toast.error).toHaveBeenCalledWith('save failed');
    });
  }
});

describe('content editor destinations', () => {
  const pickerFor = (key: ContentKey, path: string) =>
    within(
      screen.getByRole('group', {
        name: BLOCK_FIELDS[key].fields.find((f) => f.path === path)?.label,
      }),
    );
  const choose = (
    picker: ReturnType<typeof within>,
    name: string,
    value: string,
  ) =>
    fireEvent.change(picker.getByRole('combobox', { name }), {
      target: { value },
    });
  const save = () =>
    act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
    });
  const sentBody = () => putData.mock.calls[0][1] as Record<string, unknown>;

  it('saves a picked destination with its block, previewing where it goes', async () => {
    putData.mockResolvedValue({
      key: 'home.philosophy',
      value: DEFAULT_CONTENT['home.philosophy'],
    });
    render(
      <ContentEditor
        options={OPTIONS}
        keys={['home.philosophy']}
        values={{ 'home.philosophy': DEFAULT_CONTENT['home.philosophy'] }}
      />,
    );
    const picker = pickerFor('home.philosophy', 'ctaLink');
    // Nothing saved yet: the preview is the code destination.
    expect(picker.getByText(PATHS.ABOUT)).toBeTruthy();

    choose(picker, LINK_PICKER_LABELS.type, 'shop');
    choose(picker, LINK_PICKER_LABELS.category, TOYS.id);
    choose(picker, LINK_PICKER_LABELS.pet, 'dog');
    expect(
      picker.getByText(shopPath({ category: TOYS.slug, pet: 'dog' })),
    ).toBeTruthy();
    // Re-pointing the category keeps the pet already chosen.
    choose(picker, LINK_PICKER_LABELS.category, DRY.id);

    await save();
    expect(putData).toHaveBeenCalledWith(
      apiAdminContentPath('home.philosophy'),
      expect.objectContaining({
        ctaLink: { type: 'shop', categoryId: DRY.id, pet: 'dog' },
      }),
    );
  });

  it('stores only the filters picked: a category-only shop link has no pet', async () => {
    putData.mockResolvedValue({
      key: 'about.cta',
      value: DEFAULT_CONTENT['about.cta'],
    });
    render(
      <ContentEditor
        options={OPTIONS}
        keys={['about.cta']}
        values={{ 'about.cta': DEFAULT_CONTENT['about.cta'] }}
      />,
    );
    const picker = pickerFor('about.cta', 'ctaLink');
    choose(picker, LINK_PICKER_LABELS.type, 'shop');
    choose(picker, LINK_PICKER_LABELS.category, DRY.id);

    await save();
    // «همه حیوانات» stores no `pet` at all; an empty one would fail the schema.
    expect(putData).toHaveBeenCalledWith(
      apiAdminContentPath('about.cta'),
      expect.objectContaining({
        ctaLink: { type: 'shop', categoryId: DRY.id },
      }),
    );
  });

  it('refuses a URL that is not https on its picker, without sending', async () => {
    render(
      <ContentEditor
        options={OPTIONS}
        keys={['about.cta']}
        values={{ 'about.cta': DEFAULT_CONTENT['about.cta'] }}
      />,
    );
    const picker = pickerFor('about.cta', 'ctaLink');
    choose(picker, LINK_PICKER_LABELS.type, 'external');
    fireEvent.change(
      picker.getByRole('textbox', { name: LINK_PICKER_LABELS.url }),
      { target: { value: 'http://example.com' } },
    );

    await save();
    expect(putData).not.toHaveBeenCalled();
    expect(picker.getByText(LINK_MESSAGES.url)).toBeTruthy();

    // Correcting the URL clears the error reported under it (`ctaLink.url`).
    fireEvent.change(
      picker.getByRole('textbox', { name: LINK_PICKER_LABELS.url }),
      { target: { value: 'https://example.com' } },
    );
    expect(picker.queryByText(LINK_MESSAGES.url)).toBeNull();
  });

  it('shows the server refusing a deleted category on that picker', async () => {
    putData.mockRejectedValue(
      new ApiRequestError(400, 'ورودی نامعتبر است.', [
        `ctaLink: ${LINK_MESSAGES.missingCategory}`,
      ]),
    );
    render(
      <ContentEditor
        options={OPTIONS}
        keys={['about.cta']}
        values={{
          'about.cta': {
            ...DEFAULT_CONTENT['about.cta'],
            ctaLink: {
              type: 'shop',
              categoryId: DELETED_ID,
            },
          },
        }}
      />,
    );

    await save();
    expect(
      pickerFor('about.cta', 'ctaLink').getByText(
        LINK_MESSAGES.missingCategory,
      ),
    ).toBeTruthy();
    // The deleted category stays selected, under its own «deleted» option.
    const category = pickerFor('about.cta', 'ctaLink').getByRole('combobox', {
      name: LINK_PICKER_LABELS.category,
    }) as HTMLSelectElement;
    expect(category.value).toBe(DELETED_ID);
  });

  it('saves a product destination, starting from the first active product', async () => {
    putData.mockResolvedValue({
      key: 'about.cta',
      value: DEFAULT_CONTENT['about.cta'],
    });
    render(
      <ContentEditor
        options={OPTIONS}
        keys={['about.cta']}
        values={{ 'about.cta': DEFAULT_CONTENT['about.cta'] }}
      />,
    );
    const picker = pickerFor('about.cta', 'ctaLink');
    const [ball] = OPTIONS.products;
    choose(picker, LINK_PICKER_LABELS.type, 'product');
    const product = picker.getByRole('combobox', {
      name: LINK_PICKER_LABELS.product,
    }) as HTMLSelectElement;
    expect(product.value).toBe(ball.id);
    expect(picker.getByText(productPath(ball.slug))).toBeTruthy();

    await save();
    expect(putData).toHaveBeenCalledWith(
      apiAdminContentPath('about.cta'),
      expect.objectContaining({
        ctaLink: { type: 'product', productId: ball.id },
      }),
    );
  });

  it('offers the product type only while an active product exists', () => {
    const productType = (options: LinkOptions) => {
      cleanup();
      render(
        <ContentEditor
          options={options}
          keys={['about.cta']}
          values={{ 'about.cta': DEFAULT_CONTENT['about.cta'] }}
        />,
      );
      const type = pickerFor('about.cta', 'ctaLink').getByRole('combobox', {
        name: LINK_PICKER_LABELS.type,
      }) as HTMLSelectElement;
      return [...type.options].find((option) => option.value === 'product');
    };
    expect(productType(OPTIONS)?.disabled).toBe(false);
    expect(productType({ ...OPTIONS, products: [] })?.disabled).toBe(true);
  });

  it('keeps a saved product that is no longer offered selected, under its own option', () => {
    render(
      <ContentEditor
        options={OPTIONS}
        keys={['about.cta']}
        values={{
          'about.cta': {
            ...DEFAULT_CONTENT['about.cta'],
            ctaLink: { type: 'product', productId: DELETED_ID },
          },
        }}
      />,
    );
    const picker = pickerFor('about.cta', 'ctaLink');
    const product = picker.getByRole('combobox', {
      name: LINK_PICKER_LABELS.product,
    }) as HTMLSelectElement;
    // Not silently the first product: the stale id stays selected, and the
    // storefront already sends it to the shop.
    expect(product.value).toBe(DELETED_ID);
    expect(picker.getByText(PATHS.SHOP)).toBeTruthy();
  });

  it('saves a header nav destination at its own position in the list', async () => {
    putData.mockResolvedValue({ key: 'header', value: DEFAULT_CONTENT.header });
    render(
      <ContentEditor
        options={OPTIONS}
        keys={['header']}
        values={{ header: DEFAULT_CONTENT.header }}
      />,
    );
    const picker = pickerFor('header', 'navLinks.2');
    choose(picker, LINK_PICKER_LABELS.type, 'page');
    choose(picker, LINK_PICKER_LABELS.page, 'account');

    await save();
    const navLinks = sentBody().navLinks as unknown[];
    expect(Array.isArray(navLinks)).toBe(true);
    expect(navLinks).toHaveLength(3);
    expect(navLinks[2]).toEqual({ type: 'page', page: 'account' });
  });

  it('keeps a routine tab’s categories in picking order, at most four', async () => {
    const five = [
      DRY,
      TOYS,
      {
        id: '7e6d5c4b-3a2f-4e1d-9c0b-a9f8e7d6c5b4',
        title: 'تشویقی',
        slug: 'treats',
      },
      {
        id: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
        title: 'مکمل',
        slug: 'supplements',
      },
      {
        id: '8f7e6d5c-4b3a-4f2e-8d1c-0b9a8f7e6d5c',
        title: 'بهداشت',
        slug: 'hygiene',
      },
    ];
    putData.mockResolvedValue({
      key: 'home.routine',
      value: DEFAULT_CONTENT['home.routine'],
    });
    render(
      <ContentEditor
        options={{ ...OPTIONS, categories: five }}
        keys={['home.routine']}
        values={{ 'home.routine': DEFAULT_CONTENT['home.routine'] }}
      />,
    );
    const picker = pickerFor('home.routine', 'slots.0.categoryIds');
    for (const category of [five[3], five[0], five[1], five[2]]) {
      fireEvent.click(picker.getByRole('checkbox', { name: category.title }));
    }
    const box = (category: { title: string }) =>
      picker.getByRole('checkbox', {
        name: category.title,
      }) as HTMLInputElement;
    // A fifth cannot be added: a tab shows four tiles at most…
    expect(box(five[4]).disabled).toBe(true);
    // …but a picked one can still be removed, which frees the slot.
    expect(box(five[0]).disabled).toBe(false);
    fireEvent.click(box(five[0]));
    expect(box(five[4]).disabled).toBe(false);
    fireEvent.click(box(five[4]));

    await save();
    const slots = sentBody().slots as { categoryIds?: string[] }[];
    expect(slots[0].categoryIds).toEqual([
      five[3].id,
      five[1].id,
      five[2].id,
      five[4].id,
    ]);
  });

  it('clears a routine tab back to its code categories when every pick is removed', async () => {
    putData.mockResolvedValue({
      key: 'home.routine',
      value: DEFAULT_CONTENT['home.routine'],
    });
    render(
      <ContentEditor
        options={OPTIONS}
        keys={['home.routine']}
        values={{ 'home.routine': DEFAULT_CONTENT['home.routine'] }}
      />,
    );
    const picker = pickerFor('home.routine', 'slots.0.categoryIds');
    fireEvent.click(picker.getByRole('checkbox', { name: TOYS.title }));
    fireEvent.click(picker.getByRole('checkbox', { name: TOYS.title }));

    await save();
    // Unset, not an empty list — which the schema would refuse.
    const slots = sentBody().slots as { categoryIds?: string[] }[];
    expect(slots[0].categoryIds).toBeUndefined();
  });

  it('lists a deleted category a tab still holds, so it can be removed', async () => {
    putData.mockResolvedValue({
      key: 'home.routine',
      value: DEFAULT_CONTENT['home.routine'],
    });
    const routine = DEFAULT_CONTENT['home.routine'];
    const slots = [...routine.slots] as typeof routine.slots;
    slots[0] = {
      ...slots[0],
      categoryIds: [DELETED_ID],
    };
    render(
      <ContentEditor
        options={OPTIONS}
        keys={['home.routine']}
        values={{ 'home.routine': { ...routine, slots } }}
      />,
    );
    const picker = pickerFor('home.routine', 'slots.0.categoryIds');
    fireEvent.click(picker.getByRole('checkbox', { checked: true }));

    await save();
    const sent = sentBody().slots as { categoryIds?: string[] }[];
    expect(sent[0].categoryIds).toBeUndefined();
  });

  it('shows a refused routine category on its own tab, and clears only that tab’s error once fixed', async () => {
    putData.mockRejectedValue(
      new ApiRequestError(400, 'ورودی نامعتبر است.', [
        `slots.0.categoryIds: ${LINK_MESSAGES.missingCategory}`,
        `slots.1.categoryIds: ${LINK_MESSAGES.missingCategory}`,
      ]),
    );
    const routine = DEFAULT_CONTENT['home.routine'];
    const slots = [...routine.slots] as typeof routine.slots;
    slots[0] = { ...slots[0], categoryIds: [DELETED_ID] };
    slots[1] = { ...slots[1], categoryIds: [DELETED_ID] };
    render(
      <ContentEditor
        options={OPTIONS}
        keys={['home.routine']}
        values={{ 'home.routine': { ...routine, slots } }}
      />,
    );
    const tab = (i: number) =>
      pickerFor('home.routine', `slots.${i}.categoryIds`);

    await save();
    expect(tab(0).getByText(LINK_MESSAGES.missingCategory)).toBeTruthy();
    expect(tab(1).getByText(LINK_MESSAGES.missingCategory)).toBeTruthy();

    // Removing the deleted pick clears that tab's error and leaves the other's.
    fireEvent.click(tab(0).getByRole('checkbox', { checked: true }));
    expect(tab(0).queryByText(LINK_MESSAGES.missingCategory)).toBeNull();
    expect(tab(1).getByText(LINK_MESSAGES.missingCategory)).toBeTruthy();
  });

  it('clears a saved destination back to its code default', async () => {
    putData.mockResolvedValue({
      key: 'about.cta',
      value: DEFAULT_CONTENT['about.cta'],
    });
    render(
      <ContentEditor
        options={OPTIONS}
        keys={['about.cta']}
        values={{
          'about.cta': {
            ...DEFAULT_CONTENT['about.cta'],
            ctaLink: { type: 'external', url: 'https://example.com/' },
          },
        }}
      />,
    );
    const picker = pickerFor('about.cta', 'ctaLink');
    choose(picker, LINK_PICKER_LABELS.type, '');
    // The preview is the code destination again.
    expect(picker.getByText(PATHS.SHOP)).toBeTruthy();

    await save();
    expect(sentBody().ctaLink).toBeUndefined();
  });
});
