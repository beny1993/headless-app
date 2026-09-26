// Pins how the discount manager reports request failures: a failed create or a
// failed activate/deactivate is an error toast — in Persian, never a 5xx's
// English `Internal server error`. Mocked at the module edge: the
// api-client's senders and `sonner`'s `toast`; `ApiRequestError` stays real.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api-client';
import type { DiscountCodeView } from '@/lib/hono/routes/admin-discounts';
import { DiscountManager } from './discount-manager';

const { postData, patchData, toast } = vi.hoisted(() => ({
  postData: vi.fn(),
  patchData: vi.fn(),
  toast: { error: vi.fn() },
}));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  postData,
  patchData,
}));
vi.mock('sonner', () => ({ toast }));

const CODE: DiscountCodeView = {
  id: '55555555-5555-4555-8555-555555555555',
  code: 'WELCOME10',
  type: 'percent',
  value: 10,
  expiresAt: null,
  usageLimit: null,
  usageCount: 0,
  minOrderAmount: 0,
  isActive: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DiscountManager request failures', () => {
  it('reports a failed create as an error toast', async () => {
    postData.mockRejectedValue(
      new ApiRequestError(500, 'Internal server error'),
    );
    render(<DiscountManager initialCodes={[]} />);

    fireEvent.change(screen.getByLabelText('کد'), {
      target: { value: 'SUMMER' },
    });
    fireEvent.change(screen.getByLabelText(/^درصد/), {
      target: { value: '10' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ساخت کد' }));
    });

    expect(postData).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith(
      'ساخت کد تخفیف ناموفق بود. دوباره تلاش کن.',
    );
  });

  it('reports a failed activate/deactivate as an error toast', async () => {
    patchData.mockRejectedValue(
      new ApiRequestError(500, 'Internal server error'),
    );
    render(<DiscountManager initialCodes={[CODE]} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'غیرفعال کن' }));
    });

    expect(toast.error).toHaveBeenCalledWith('تغییر وضعیت ناموفق بود.');
  });
});

describe('DiscountManager number fields', () => {
  it('refuses a percent typed as 7,5 instead of creating a 75% code', async () => {
    render(<DiscountManager initialCodes={[]} />);

    fireEvent.change(screen.getByLabelText('کد'), {
      target: { value: 'SUMMER' },
    });
    fireEvent.change(screen.getByLabelText(/^درصد/), {
      target: { value: '7,5' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ساخت کد' }));
    });

    expect(postData).not.toHaveBeenCalled();
    expect(
      screen.getByText('درصد تخفیف باید عددی صحیح بین ۱ تا ۱۰۰ باشد.'),
    ).toBeTruthy();
  });
});
