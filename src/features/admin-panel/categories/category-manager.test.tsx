// Pins how the category manager reports request failures: as error toasts (a
// refused delete carries the server's Persian reason), while a field refusal
// stays next to its field. Mocked at the module edge: the api-client's senders
// and `sonner`'s `toast`; `ApiRequestError` and the field-error mapping are real.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api-client';
import type { CategoryView } from '@/lib/hono/routes/admin-categories';
import { CategoryManager } from './category-manager';

const { postData, delData, toast } = vi.hoisted(() => ({
  postData: vi.fn(),
  delData: vi.fn(),
  toast: { error: vi.fn() },
}));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  postData,
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
    postData.mockRejectedValue(new Error('server down'));
    render(<CategoryManager initialCategories={[]} />);

    await create();

    expect(toast.error).toHaveBeenCalledWith('server down');
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
    expect(screen.getByText(DRY.title)).toBeTruthy();
  });
});
