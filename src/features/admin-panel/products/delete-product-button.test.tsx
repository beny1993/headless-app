// Pins the deactivate control's wiring: a confirmed click DELETEs the product and
// refreshes the list, a cancelled confirm sends nothing, and a failed request is
// reported as an error toast (not a blocking window.alert) with the button usable
// again. Mocked at the module edge: `next/navigation`, `@/lib/api-client` and
// `sonner` are recorders.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiAdminProductPath } from '@/lib/constant/paths';
import { DeleteProductButton } from './delete-product-button';

const { refresh, delData, toast } = vi.hoisted(() => ({
  refresh: vi.fn(),
  delData: vi.fn(),
  toast: { error: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/api-client', () => ({ delData }));
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
});
