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
import { DEFAULT_ERROR_MESSAGE } from '@/lib/api-client';
import { IMAGE_TOO_LARGE_MESSAGE } from '@/lib/hono/image-upload';
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
const BALL = {
  id: '9d8c7b6a-5f4e-4d3c-8b2a-0f1e2d3c4b5a',
  title: 'توپ گربه',
  slug: 'cat-ball',
};
const FOOD = {
  id: '3a4b5c6d-7e8f-4a0b-9c1d-2e3f4a5b6c7d',
  title: 'غذای خشک گربه',
  slug: 'cat-dry-food',
};
/** A category or product id the catalog no longer has. */
const DELETED_ID = '11111111-2222-4333-8444-555555555555';
const OPTIONS: LinkOptions = {
  categories: [DRY, TOYS],
  mainCategories: [DRY, TOYS],
  products: [BALL],
  cards: [BALL, FOOD],
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
    // A dead connection's own text is English; the admin reads the fallback.
    expect(toast.error).toHaveBeenCalledWith(DEFAULT_ERROR_MESSAGE);
    expect(putData).not.toHaveBeenCalled();
    expect(document.querySelector('fieldset')?.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shows the server’s own sentence when an image is too large', async () => {
    // The 413 the `bodyLimit` mount answers with. It says which thing to fix —
    // pick a smaller photo — where the generic fallback only says «try again»,
    // and an admin following that one re-uploads the same oversize file.
    // Wiring, not logic: the fetch, the envelope unwrap and the toast are three
    // modules, and only a render reaches all three.
    //
    // This case alone does NOT pin the move to `postForm`: the hand-rolled
    // helper it replaced also read `message`, so it passes against that too.
    // The case below it is the one that fails when the old helper is put back.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 'error',
            message: IMAGE_TOO_LARGE_MESSAGE,
          }),
          { status: 413, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
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
        files: [new File(['image'], 'huge.png', { type: 'image/png' })],
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
    });

    expect(toast.error).toHaveBeenCalledWith(IMAGE_TOO_LARGE_MESSAGE);
    expect(putData).not.toHaveBeenCalled();
  });

  it('falls back to Persian when the refusal is not this app’s', async () => {
    // A CDN or ingress 413: an HTML page, no envelope, no `message`. The old
    // hand-rolled helper answered this with its own `IMAGE_UPLOAD_FAILED`;
    // `postForm` answers with `DEFAULT_ERROR_MESSAGE`. Both are Persian — the
    // point is that one exists at all, since the shared client fallback used to
    // be an English sentence that `reasonFrom` would forward as though the
    // server had written it for the admin.
    //
    // This is the revert-proof for this file: restore the old helper and this
    // assertion fails on the wrong Persian sentence.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>413 Request Entity Too Large</html>', {
          status: 413,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );
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
        files: [new File(['image'], 'huge.png', { type: 'image/png' })],
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
    });

    expect(toast.error).toHaveBeenCalledWith(DEFAULT_ERROR_MESSAGE);
    expect(putData).not.toHaveBeenCalled();
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
        else fail(new ApiRequestError(403, 'دسترسی ندارید.'));
      });
      expect(
        fields.every((field) => field.closest('fieldset')?.disabled === false),
      ).toBe(true);
      if (!succeeds) expect(toast.error).toHaveBeenCalledWith('دسترسی ندارید.');
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
  /** The text a control's `aria-describedby` points at — what a screen reader hears. */
  const describedBy = (control: HTMLElement) =>
    document.getElementById(control.getAttribute('aria-describedby') ?? '')
      ?.textContent;

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
    expect(picker.getByText(shopPath({ category: TOYS.slug }))).toBeTruthy();
    // Re-pointing the category replaces the one chosen before.
    choose(picker, LINK_PICKER_LABELS.category, DRY.id);

    await save();
    expect(putData).toHaveBeenCalledWith(
      apiAdminContentPath('home.philosophy'),
      expect.objectContaining({
        ctaLink: { type: 'shop', categoryId: DRY.id },
      }),
    );
  });

  it('stores only the filters picked: «all categories» stores no category', async () => {
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
    choose(picker, LINK_PICKER_LABELS.category, '');

    await save();
    // «همه دسته‌بندی‌ها» stores no `categoryId` at all; an empty one would
    // fail the schema.
    expect(putData).toHaveBeenCalledWith(
      apiAdminContentPath('about.cta'),
      expect.objectContaining({
        ctaLink: { type: 'shop' },
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
    // …and a screen reader hears why, not just a red border.
    expect(category.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(category)).toContain(LINK_MESSAGES.missingCategory);
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

  it('picks the home strip from the main categories, listing the six tiles it shows', async () => {
    // Seven main categories in display order, and a sub-category.
    const main = [
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
      {
        id: '4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d',
        title: 'غذای تر',
        slug: 'wet-food',
      },
      {
        id: '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a',
        title: 'قلاده',
        slug: 'collars',
      },
    ];
    const shampoo = {
      id: '6e5d4c3b-2a1f-4e0d-9c8b-7a6f5e4d3c2b',
      title: 'شامپو',
      slug: 'shampoo',
    };
    putData.mockResolvedValue({
      key: 'home.categories',
      value: DEFAULT_CONTENT['home.categories'],
    });
    render(
      <ContentEditor
        options={{
          ...OPTIONS,
          categories: [...main, shampoo],
          mainCategories: main,
        }}
        keys={['home.categories']}
        values={{ 'home.categories': DEFAULT_CONTENT['home.categories'] }}
      />,
    );
    const picker = pickerFor('home.categories', 'categoryIds');
    const box = (category: { title: string }) =>
      picker.getByRole('checkbox', {
        name: category.title,
      }) as HTMLInputElement;
    // Each tile the list shows, as its number and title, and «خودکار» for a
    // slot the display order fills.
    const tiles = () =>
      within(picker.getByRole('list'))
        .getAllByRole('listitem')
        .map((row) =>
          [...row.children]
            .map((part) => part.textContent)
            .filter(Boolean)
            .join(' '),
        );

    // A sub-category never reaches the strip, so it is not offered.
    expect(picker.queryByRole('checkbox', { name: shampoo.title })).toBeNull();
    // Nothing picked: the first six in display order.
    expect(tiles()).toEqual([
      '۱ غذای خشک خودکار',
      '۲ اسباب‌بازی خودکار',
      '۳ تشویقی خودکار',
      '۴ مکمل خودکار',
      '۵ بهداشت خودکار',
      '۶ غذای تر خودکار',
    ]);

    // Picked out of order: those first, in picking order, the rest behind.
    fireEvent.click(box(main[6]));
    fireEvent.click(box(main[2]));
    expect(tiles()).toEqual([
      '۱ قلاده',
      '۲ تشویقی',
      '۳ غذای خشک خودکار',
      '۴ اسباب‌بازی خودکار',
      '۵ مکمل خودکار',
      '۶ بهداشت خودکار',
    ]);

    // Six at most — the strip's own count.
    for (const category of [main[0], main[1], main[3], main[4]]) {
      fireEvent.click(box(category));
    }
    expect(box(main[5]).disabled).toBe(true);

    await save();
    expect(sentBody().categoryIds).toEqual([
      main[6].id,
      main[2].id,
      main[0].id,
      main[1].id,
      main[3].id,
      main[4].id,
    ]);
  });

  // What is saved is the list, whatever order the boxes were ticked in. The
  // grips are found by their event names — the E2E suite selects them so too.
  const reorderGrips = (event: string) =>
    document.querySelectorAll(`[data-umami-event="${event}"]`);

  it('saves the home picks in the list’s order, not the order they were ticked', async () => {
    putData.mockResolvedValue({
      key: 'home.categories',
      value: DEFAULT_CONTENT['home.categories'],
    });
    render(
      <ContentEditor
        options={OPTIONS}
        keys={['home.categories']}
        values={{ 'home.categories': DEFAULT_CONTENT['home.categories'] }}
      />,
    );
    const picker = pickerFor('home.categories', 'categoryIds');
    fireEvent.click(picker.getByRole('checkbox', { name: DRY.title }));
    fireEvent.click(picker.getByRole('checkbox', { name: TOYS.title }));
    const grips = reorderGrips('admin-panel-content-home-category-reorder');
    expect(grips).toHaveLength(2);

    // Ticked second, moved above the first.
    fireEvent.keyDown(grips[1], { key: 'ArrowUp' });

    await save();
    expect(sentBody().categoryIds).toEqual([TOYS.id, DRY.id]);
  });

  it('clears the home strip back to display order when every pick is removed', async () => {
    putData.mockResolvedValue({
      key: 'home.categories',
      value: DEFAULT_CONTENT['home.categories'],
    });
    render(
      <ContentEditor
        options={OPTIONS}
        keys={['home.categories']}
        values={{ 'home.categories': DEFAULT_CONTENT['home.categories'] }}
      />,
    );
    const picker = pickerFor('home.categories', 'categoryIds');
    fireEvent.click(picker.getByRole('checkbox', { name: TOYS.title }));
    fireEvent.click(picker.getByRole('checkbox', { name: TOYS.title }));

    await save();
    // Unset, not an empty list — which the schema would refuse.
    expect(sentBody().categoryIds).toBeUndefined();
  });

  it('lists a deleted category the strip still holds, so it can be removed', async () => {
    putData.mockResolvedValue({
      key: 'home.categories',
      value: DEFAULT_CONTENT['home.categories'],
    });
    render(
      <ContentEditor
        options={OPTIONS}
        keys={['home.categories']}
        values={{
          'home.categories': {
            ...DEFAULT_CONTENT['home.categories'],
            categoryIds: [DELETED_ID],
          },
        }}
      />,
    );
    const picker = pickerFor('home.categories', 'categoryIds');
    fireEvent.click(picker.getByRole('checkbox', { checked: true }));

    await save();
    expect(sentBody().categoryIds).toBeUndefined();
  });

  describe('the «پیشنهادهای ما» boxes', () => {
    const recommends = DEFAULT_CONTENT['home.recommends'];
    const renderBoxes = (value: typeof recommends = recommends) => {
      render(
        <ContentEditor
          options={OPTIONS}
          keys={['home.recommends']}
          values={{ 'home.recommends': value }}
        />,
      );
      return pickerFor('home.recommends', 'productIds');
    };
    const box = (picker: ReturnType<typeof within>, n: string) =>
      picker.getByRole('combobox', { name: `کارت ${n}` }) as HTMLSelectElement;
    const optionIn = (select: HTMLSelectElement, id: string) =>
      [...select.options].find((option) => option.value === id);

    it('saves each pick in its own box, «خودکار» ones as null, a product in one box only', async () => {
      putData.mockResolvedValue({ key: 'home.recommends', value: recommends });
      const picker = renderBoxes();
      choose(picker, 'کارت ۲', FOOD.id);
      choose(picker, 'کارت ۴', BALL.id);

      // A product already in a box cannot be picked into another one…
      expect(optionIn(box(picker, '۱'), FOOD.id)?.disabled).toBe(true);
      // …and stays picked, and pickable, in its own.
      expect(optionIn(box(picker, '۲'), FOOD.id)?.disabled).toBe(false);

      await save();
      expect(sentBody().productIds).toEqual([null, FOOD.id, null, BALL.id]);
    });

    it('stores nothing once every box is back on «خودکار»', async () => {
      putData.mockResolvedValue({ key: 'home.recommends', value: recommends });
      const picker = renderBoxes({
        ...recommends,
        productIds: [FOOD.id, null, null, null],
      });
      expect(box(picker, '۱').value).toBe(FOOD.id);
      choose(picker, 'کارت ۱', '');

      await save();
      // Unset, not four nulls: the block reads as it did before any pick.
      expect(sentBody().productIds).toBeUndefined();
    });

    it('keeps a saved pick the shop no longer offers selected, and shows its refusal until re-pointed', async () => {
      putData.mockRejectedValue(
        new ApiRequestError(400, 'ورودی نامعتبر است.', [
          `productIds: ${LINK_MESSAGES.missingCard}`,
        ]),
      );
      const picker = renderBoxes({
        ...recommends,
        productIds: [null, DELETED_ID, null, null],
      });
      // Selected under an option of its own, not silently shown as «خودکار».
      expect(box(picker, '۲').value).toBe(DELETED_ID);

      await save();
      expect(picker.getByText(LINK_MESSAGES.missingCard)).toBeTruthy();
      // Every box is marked, and a screen reader on any of them hears why.
      for (const n of ['۱', '۲', '۳', '۴']) {
        expect(box(picker, n).getAttribute('aria-invalid')).toBe('true');
        expect(describedBy(box(picker, n))).toContain(
          LINK_MESSAGES.missingCard,
        );
      }
      choose(picker, 'کارت ۲', FOOD.id);
      expect(picker.queryByText(LINK_MESSAGES.missingCard)).toBeNull();
      expect(box(picker, '۲').getAttribute('aria-invalid')).toBe('false');
    });
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
