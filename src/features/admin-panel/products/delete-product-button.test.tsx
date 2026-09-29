// Pins the deactivate control's wiring: a confirmed click DELETEs the product and
// refreshes the list, a cancelled confirm sends nothing, and a failed request is
// reported as an error toast (not a blocking window.alert) with the button usable
// again. Mocked at the module edge: `next/navigation`, `@/lib/api-client` and
// `sonner` are recorders.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api-client';
import { apiAdminProductPath } from '@/lib/constant/paths';
import { DeleteProductButton } from './delete-product-button';

const { refresh, delData, toast } = vi.hoisted(() => ({
  refresh: vi.fn(),
  delData: vi.fn(),
  toast: { error: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/api-client', async (importOriginal) => ({
  // `delData` is a recorder, but `ApiRequestError` is the REAL class: the
  // component narrows on it to tell the server's Persian refusal from an
  // internal transport string, so a stubbed class would make that branch
  // untestable rather than tested.
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  delData,
}));
vi.mock('sonner', () => ({ toast }));

const ID = '11111111-1111-4111-8111-111111111111';
const TITLE = 'غذای گربه';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const button = () =>
  screen.getByRole('button', {
    name: `غیرفعال کردن ${TITLE}`,
  }) as HTMLButtonElement;

const click = () =>
  act(async () => {
    fireEvent.click(button());
  });

describe('DeleteProductButton', () => {
  it('deactivates the product and refreshes the list once confirmed', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    delData.mockResolvedValue({});
    render(<DeleteProductButton id={ID} title={TITLE} />);

    await click();

    expect(delData).toHaveBeenCalledWith(apiAdminProductPath(ID));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('sends nothing when the confirm is cancelled', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    );
    render(<DeleteProductButton id={ID} title={TITLE} />);

    await click();

    expect(delData).not.toHaveBeenCalled();
  });

  it('reports a failed deactivation as an error toast, not a blocking alert', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    delData.mockRejectedValue(new Error('network down'));
    render(<DeleteProductButton id={ID} title={TITLE} />);

    await click();

    expect(toast.error).toHaveBeenCalledWith(
      'غیرفعال کردن محصول ناموفق بود. دوباره تلاش کن.',
    );
    expect(alert).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
  });

  it('shows the server’s own refusal instead of the retry advice', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    const refusal =
      'این محصول ۲ زیرمجموعه فعال دارد؛ اول آن‌ها را جابه‌جا یا غیرفعال کن.';
    delData.mockRejectedValue(new ApiRequestError(409, refusal));
    render(<DeleteProductButton id={ID} title={TITLE} />);

    await click();

    // A family head names how many members block it, and retrying can never
    // clear that — «دوباره تلاش کن» would send the admin round a loop that
    // cannot end. The generic sentence stays for transport failures, where
    // retrying is the right advice (the test above).
    expect(toast.error).toHaveBeenCalledWith(refusal);
  });
});
