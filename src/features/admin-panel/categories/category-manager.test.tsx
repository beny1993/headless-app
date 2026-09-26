// Pins how the category manager reports request failures: as error toasts (a
// refused delete carries the server's Persian reason), while a field refusal
// stays next to its field. Mocked at the module edge: the api-client's senders
// and `sonner`'s `toast`; `ApiRequestError` and the field-error mapping are real.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api-client';
import { CATEGORY_PARENT_MESSAGES } from '@/lib/catalog/category-input';
import type { CategoryView } from '@/lib/hono/routes/admin-categories';
import { CategoryManager } from './category-manager';

const { postData, putData, delData, toast } = vi.hoisted(() => ({
  postData: vi.fn(),
  putData: vi.fn(),
  delData: vi.fn(),
  toast: { error: vi.fn() },
}));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  postData,
  putData,
  delData,
}));
vi.mock('sonner', () => ({ toast }));

const DRY: CategoryView = {
  id: '44444444-4444-4444-8444-444444444444',
  title: 'غذای خشک',
  slug: 'dry-food',
  sortOrder: 1,
  parentId: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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
      .map((row) => row.querySelectorAll('td')[1]?.textContent);

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
