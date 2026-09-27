// Pins how the category manager reports request failures: as error toasts (a
// refused delete carries the server's Persian reason), while a field refusal
// stays next to its field — and how a photo rides a save: uploaded first, its
// key then sent with the category. Mocked at the module edge: the api-client's
// senders and `sonner`'s `toast`; `ApiRequestError` and the field-error mapping
// are real.
import { act } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api-client';
import { CATEGORY_PARENT_MESSAGES } from '@/lib/catalog/category-input';
import { API_PATHS } from '@/lib/constant/paths';
import type { CategoryView } from '@/lib/hono/routes/admin-categories';
import { IMAGE_TYPE_ERROR } from '@/lib/storage/image-upload';
import { imageSrc } from '@/lib/storage/image-url';
import { CategoryManager } from './category-manager';

const { postData, putData, delData, postForm, toast } = vi.hoisted(() => ({
  postData: vi.fn(),
  putData: vi.fn(),
  delData: vi.fn(),
  postForm: vi.fn(),
  toast: { error: vi.fn() },
}));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  postData,
  putData,
  delData,
  postForm,
}));
vi.mock('sonner', () => ({ toast }));

const DRY: CategoryView = {
  id: '44444444-4444-4444-8444-444444444444',
  title: 'غذای خشک',
  slug: 'dry-food',
  sortOrder: 1,
  parentId: null,
  imageKey: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const create = async () => {
  fireEvent.change(screen.getByLabelText('عنوان'), {
    target: { value: 'غذای تر' },
  });
  fireEvent.change(screen.getByLabelText('نشانی (slug)'), {
    target: { value: 'wet-food' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^ساخت دسته/ }));
  });
};

describe('CategoryManager request failures', () => {
  it('reports a failed create as an error toast', async () => {
    postData.mockRejectedValue(
      new ApiRequestError(500, 'Internal server error'),
    );
    render(<CategoryManager initialCategories={[]} />);

    await create();

    expect(toast.error).toHaveBeenCalledWith(
      'ذخیره دسته‌بندی ناموفق بود. دوباره تلاش کن.',
    );
  });

  it('keeps a field refusal next to its field, without a toast', async () => {
    postData.mockRejectedValue(
      new ApiRequestError(400, 'ورودی نامعتبر است.', [
        'slug: این نشانی تکراری است.',
      ]),
    );
    render(<CategoryManager initialCategories={[]} />);

    await create();

    expect(screen.getByText('این نشانی تکراری است.')).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('reports a refused delete with the server reason as an error toast', async () => {
    const reason = 'این دسته محصول دارد و حذف نمی شود.';
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    delData.mockRejectedValue(new ApiRequestError(409, reason));
    render(<CategoryManager initialCategories={[DRY]} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `حذف ${DRY.title}` }));
    });

    expect(toast.error).toHaveBeenCalledWith(reason);
    // The row, not the create form's parent option, which now carries the
    // same title.
    expect(screen.getByRole('cell', { name: DRY.title })).toBeTruthy();
  });
});

describe('CategoryManager sub-categories', () => {
  const GROOMING: CategoryView = {
    ...DRY,
    id: '55555555-5555-4555-8555-555555555555',
    title: 'شامپو و نظافت',
    slug: 'grooming',
    sortOrder: 9,
    parentId: DRY.id,
  };
  const TOYS: CategoryView = {
    ...DRY,
    id: '66666666-6666-4666-8666-666666666666',
    title: 'اسباب‌بازی',
    slug: 'toys',
    sortOrder: 2,
  };

  /** The rendered rows' slug cells, top to bottom. */
  const rowSlugs = () =>
    screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelectorAll('td')[2]?.textContent);

  // Every «دسته‌بندی مادر» select carries that same label; the create form's is
  // first in the DOM, and the row being edited owns the next one.
  const selects = () =>
    screen.getAllByLabelText('دسته‌بندی مادر') as HTMLSelectElement[];
  const createParent = () => selects()[0];
  const rowParent = () => selects()[1];

  it('renders a sub-category directly under its parent, sorted state or not', () => {
    // `sortOrder: 9` would put the sub last in a flat list; it belongs under
    // «غذای خشک» whatever its own order says.
    render(<CategoryManager initialCategories={[DRY, TOYS, GROOMING]} />);

    expect(rowSlugs()).toEqual([DRY.slug, GROOMING.slug, TOYS.slug]);
  });

  it('names the parent for a screen reader, which hears no indent', () => {
    render(<CategoryManager initialCategories={[DRY, GROOMING]} />);

    expect(
      screen.getByText(`زیردسته‌ی ${DRY.title} —`, { exact: false }),
    ).toBeTruthy();
  });

  it('sends the chosen parent when creating', async () => {
    postData.mockResolvedValue(GROOMING);
    render(<CategoryManager initialCategories={[DRY]} />);

    fireEvent.change(screen.getByLabelText('عنوان'), {
      target: { value: GROOMING.title },
    });
    fireEvent.change(screen.getByLabelText('نشانی (slug)'), {
      target: { value: GROOMING.slug },
    });
    fireEvent.change(createParent(), { target: { value: DRY.id } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^ساخت دسته/ }));
    });

    expect(postData).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ parentId: DRY.id }),
    );
  });

  it('offers only top-level categories, never the row itself', () => {
    render(<CategoryManager initialCategories={[DRY, TOYS, GROOMING]} />);

    fireEvent.click(
      screen.getByRole('button', { name: `ویرایش ${TOYS.title}` }),
    );

    expect([...rowParent().options].map((option) => option.value)).toEqual([
      '',
      DRY.id,
    ]);
  });

  it('moves a sub-category to top level by clearing the select', async () => {
    putData.mockResolvedValue({ ...GROOMING, parentId: null });
    render(<CategoryManager initialCategories={[DRY, GROOMING]} />);

    fireEvent.click(
      screen.getByRole('button', { name: `ویرایش ${GROOMING.title}` }),
    );
    fireEvent.change(rowParent(), { target: { value: '' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
    });

    expect(putData).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ parentId: null }),
    );
  });

  it('disables the select with its reason on a category that has children', () => {
    render(<CategoryManager initialCategories={[DRY, GROOMING]} />);

    fireEvent.click(
      screen.getByRole('button', { name: `ویرایش ${DRY.title}` }),
    );

    expect(rowParent().disabled).toBe(true);
    expect(screen.getByText(CATEGORY_PARENT_MESSAGES.hasChildren)).toBeTruthy();
  });

  it('shows the server’s parent refusal under the select', async () => {
    putData.mockRejectedValue(
      new ApiRequestError(400, 'ذخیره نشد.', [
        `parentId: ${CATEGORY_PARENT_MESSAGES.nested}`,
      ]),
    );
    render(<CategoryManager initialCategories={[DRY, TOYS, GROOMING]} />);

    fireEvent.click(
      screen.getByRole('button', { name: `ویرایش ${TOYS.title}` }),
    );
    fireEvent.change(rowParent(), { target: { value: DRY.id } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
    });

    expect(screen.getByText(CATEGORY_PARENT_MESSAGES.nested)).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('CategoryManager photos', () => {
  const PHOTO = 'uploads/123e4567-e89b-42d3-a456-426614174000.jpg';
  const UPLOADED = 'uploads/223e4567-e89b-42d3-a456-426614174000.png';
  const WITH_PHOTO: CategoryView = { ...DRY, imageKey: PHOTO };

  beforeEach(() => {
    // happy-dom's `createObjectURL` wants a real Blob; a distinguishable
    // string is all these tests need.
    let next = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${next++}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  const png = () =>
    new File([new Uint8Array([0x89, 0x50])], 'cat.png', { type: 'image/png' });
  /** The photo inputs: the create form's first, then an editing row's. */
  const photoInputs = () =>
    screen.getAllByLabelText('تصویر دسته‌بندی') as HTMLInputElement[];
  const pick = (input: HTMLInputElement, file: File) =>
    fireEvent.change(input, { target: { files: [file] } });
  const edit = () =>
    fireEvent.click(
      screen.getByRole('button', { name: `ویرایش ${DRY.title}` }),
    );
  const saveRow = () =>
    act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
    });
  /** The object key behind an `<img>`, through next/image's URL. */
  const shows = (scope: HTMLElement) =>
    decodeURIComponent(scope.querySelector('img')?.getAttribute('src') ?? '');

  it('uploads a picked photo first, then creates the category with its key', async () => {
    postForm.mockResolvedValue({ key: UPLOADED });
    postData.mockResolvedValue({ ...DRY, imageKey: UPLOADED });
    render(<CategoryManager initialCategories={[]} />);

    pick(photoInputs()[0], png());
    await create();

    expect(postForm).toHaveBeenCalledWith(
      API_PATHS.ADMIN_CONTENT_IMAGES,
      expect.any(FormData),
      expect.anything(),
    );
    expect(postData).toHaveBeenCalledWith(
      API_PATHS.ADMIN_CATEGORIES,
      expect.objectContaining({ imageKey: UPLOADED }),
    );
    expect(postForm.mock.invocationCallOrder[0]).toBeLessThan(
      postData.mock.invocationCallOrder[0],
    );
  });

  it('uploads nothing while the rest of the form is refused', async () => {
    render(<CategoryManager initialCategories={[]} />);

    pick(photoInputs()[0], png());
    fireEvent.change(screen.getByLabelText('نشانی (slug)'), {
      target: { value: 'Bad Slug' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^ساخت دسته/ }));
    });

    expect(postForm).not.toHaveBeenCalled();
    expect(postData).not.toHaveBeenCalled();
  });

  it('refuses a file that is no image on the field, and creates without it', async () => {
    postData.mockResolvedValue(DRY);
    render(<CategoryManager initialCategories={[]} />);

    pick(
      photoInputs()[0],
      new File(['x'], 'notes.txt', { type: 'text/plain' }),
    );
    expect(screen.getByText(IMAGE_TYPE_ERROR)).toBeTruthy();
    await create();

    expect(postForm).not.toHaveBeenCalled();
    expect(postData).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ imageKey: null }),
    );
  });

  it('keeps the uploaded key when the create is refused, so the retry does not upload again', async () => {
    postForm.mockResolvedValue({ key: UPLOADED });
    postData
      .mockRejectedValueOnce(
        new ApiRequestError(400, 'ذخیره نشد.', ['slug: این نشانی تکراری است.']),
      )
      .mockResolvedValueOnce({ ...DRY, imageKey: UPLOADED });
    render(<CategoryManager initialCategories={[]} />);

    pick(photoInputs()[0], png());
    await create();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^ساخت دسته/ }));
    });

    expect(postForm).toHaveBeenCalledTimes(1);
    expect(postData).toHaveBeenCalledTimes(2);
    expect(postData).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ imageKey: UPLOADED }),
    );
  });

  it('shows each row’s photo, and says so when a category has none', () => {
    render(
      <CategoryManager
        initialCategories={[
          WITH_PHOTO,
          { ...DRY, id: '77777777-7777-4777-8777-777777777777', slug: 'bare' },
        ]}
      />,
    );
    const [withPhoto, without] = screen.getAllByRole('row').slice(1);

    expect(shows(withPhoto)).toContain(`url=${imageSrc(PHOTO)}`);
    expect(without.querySelector('img')).toBeNull();
    expect(within(without).getByText('بدون تصویر')).toBeTruthy();
  });

  it('keeps the saved photo when an edit changes only the title', async () => {
    // PUT replaces the whole category: a body without the key would delete
    // the photo the admin never touched.
    putData.mockResolvedValue({ ...WITH_PHOTO, title: 'غذای خشک گربه' });
    render(<CategoryManager initialCategories={[WITH_PHOTO]} />);

    edit();
    fireEvent.change(screen.getAllByLabelText('عنوان')[1], {
      target: { value: 'غذای خشک گربه' },
    });
    await saveRow();

    expect(postForm).not.toHaveBeenCalled();
    expect(putData).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ imageKey: PHOTO }),
    );
  });

  it('replaces the saved photo with a new pick', async () => {
    postForm.mockResolvedValue({ key: UPLOADED });
    putData.mockResolvedValue({ ...DRY, imageKey: UPLOADED });
    render(<CategoryManager initialCategories={[WITH_PHOTO]} />);

    edit();
    pick(photoInputs()[1], png());
    await saveRow();

    expect(putData).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ imageKey: UPLOADED }),
    );
  });

  it('removes the saved photo', async () => {
    putData.mockResolvedValue(DRY);
    render(<CategoryManager initialCategories={[WITH_PHOTO]} />);

    edit();
    fireEvent.click(screen.getByRole('button', { name: 'حذف تصویر' }));
    await saveRow();

    expect(postForm).not.toHaveBeenCalled();
    expect(putData).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ imageKey: null }),
    );
  });

  it('drops a picked photo on cancel: nothing uploads, and the saved one is back', () => {
    render(<CategoryManager initialCategories={[WITH_PHOTO]} />);

    edit();
    pick(photoInputs()[1], png());
    fireEvent.click(screen.getByRole('button', { name: 'انصراف' }));
    edit();

    expect(postForm).not.toHaveBeenCalled();
    // The thumbnail and the picker's preview: both the saved photo, neither the
    // dropped pick's blob.
    const [, row] = screen.getAllByRole('row');
    const sources = [...row.querySelectorAll('img')].map((img) =>
      decodeURIComponent(img.getAttribute('src') ?? ''),
    );
    expect(sources).toHaveLength(2);
    for (const src of sources) expect(src).toContain(`url=${imageSrc(PHOTO)}`);
  });
});
