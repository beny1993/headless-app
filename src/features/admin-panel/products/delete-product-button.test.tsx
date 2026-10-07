// Pins the 🗑 control's wiring: the modal promises what the list knows (delete,
// or deactivate and why), cancelling or Escape sends nothing, a confirmed click
// DELETEs with the intent the modal showed and refreshes, and the toast says so
// when a confirmed delete came back as a deactivation. Mocked at the module edge:
// `next/navigation`, `@/lib/api-client` and `sonner` are recorders. Nothing
// here asserts on `showModal()` — happy-dom implements `<dialog>` only partly.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api-client';
import {
  DELETE_INTENTS,
  DELETE_OUTCOMES,
  HARD_DELETE_BLOCKERS,
  productDeleteSearch,
  type DeleteIntent,
  type HardDeleteBlocker,
} from '@/lib/catalog/product-delete';
import { apiAdminProductPath } from '@/lib/constant/paths';
import { DeleteProductButton } from './delete-product-button';

const { refresh, delData, toast } = vi.hoisted(() => ({
  refresh: vi.fn(),
  delData: vi.fn(),
  toast: { error: vi.fn(), warning: vi.fn() },
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
});

/** The request the button must send for what its modal showed. */
const sentWith = (confirm: DeleteIntent) =>
  `${apiAdminProductPath(ID)}${productDeleteSearch({ confirm })}`;

const renderButton = (blocker: HardDeleteBlocker | null = null) =>
  render(<DeleteProductButton id={ID} title={TITLE} blocker={blocker} />);

const event = (name: string) =>
  document.querySelector<HTMLButtonElement>(`[data-umami-event="${name}"]`)!;

const open = () =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name: `حذف ${TITLE}` }));
  });

const confirm = (name = 'admin-panel-products-delete-confirm') =>
  act(async () => {
    fireEvent.click(event(name));
  });

describe('DeleteProductButton', () => {
  describe('the modal’s promise', () => {
    it('promises a permanent delete when nothing references the product', async () => {
      renderButton(null);
      await open();

      // Named and described by its own heading and sentence, so a screen
      // reader announces the question and the warning together.
      expect(
        screen.getByRole('alertdialog', {
          name: `حذف «${TITLE}»؟`,
          description: 'این کار برگشت‌پذیر نیست.',
        }),
      ).toBeTruthy();
      expect(event('admin-panel-products-delete-confirm').textContent).toBe(
        'حذف',
      );
      expect(event('admin-panel-products-deactivate-confirm')).toBeNull();
    });

    it('offers only a deactivation for an ordered product, and says it is the orders', async () => {
      renderButton(HARD_DELETE_BLOCKERS.ORDERS);
      await open();

      const text = document.querySelector('dialog')!.textContent;
      expect(text).toContain('حذف‌شدنی نیست');
      expect(text).toContain('سفارش');
      expect(text).not.toContain('زیرمجموعه');
      expect(event('admin-panel-products-deactivate-confirm').textContent).toBe(
        'غیرفعال',
      );
      expect(event('admin-panel-products-delete-confirm')).toBeNull();
    });

    it('offers only a deactivation for a family head, and says it is the members', async () => {
      renderButton(HARD_DELETE_BLOCKERS.MEMBERS);
      await open();

      const text = document.querySelector('dialog')!.textContent;
      expect(text).toContain('حذف‌شدنی نیست');
      expect(text).toContain('زیرمجموعه');
      expect(text).not.toContain('سفارش');
      expect(event('admin-panel-products-deactivate-confirm').textContent).toBe(
        'غیرفعال',
      );
    });
  });

  describe('backing out', () => {
    it('sends nothing when the admin cancels', async () => {
      renderButton(null);
      await open();

      await act(async () => {
        fireEvent.click(event('admin-panel-products-delete-cancel'));
      });

      expect(delData).not.toHaveBeenCalled();
    });

    it('sends nothing on Escape', async () => {
      renderButton(null);
      await open();

      await act(async () => {
        fireEvent.keyDown(document.querySelector('dialog')!, {
          key: 'Escape',
        });
      });

      expect(delData).not.toHaveBeenCalled();
    });
  });

  describe('confirming', () => {
    it('deletes and refreshes the list, with no toast when the server did what was promised', async () => {
      delData.mockResolvedValue({ outcome: DELETE_OUTCOMES.DELETED });
      renderButton(null);
      await open();

      await confirm();

      expect(delData).toHaveBeenCalledWith(sentWith(DELETE_INTENTS.DELETE));
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(toast.warning).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('shows the busy state on the confirm button while the request runs', async () => {
      let answer: (value: unknown) => void = () => undefined;
      delData.mockReturnValue(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
      renderButton(null);
      await open();

      await confirm();

      const button = event('admin-panel-products-delete-confirm');
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-busy')).toBe('true');
      // A second click while the first is in flight sends nothing more.
      await confirm();
      expect(delData).toHaveBeenCalledTimes(1);

      await act(async () => {
        answer({ outcome: DELETE_OUTCOMES.DELETED });
      });
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('says so when a promised delete came back as a deactivation', async () => {
      // An order landed between the list's read and the click: the server,
      // which decides under the row lock, kept the row.
      delData.mockResolvedValue({ outcome: DELETE_OUTCOMES.DEACTIVATED });
      renderButton(null);
      await open();

      await confirm();

      expect(toast.warning).toHaveBeenCalledTimes(1);
      const [message] = toast.warning.mock.calls[0] as [string];
      expect(message).toContain(TITLE);
      expect(message).toContain('غیرفعال شد');
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it.each([HARD_DELETE_BLOCKERS.ORDERS, HARD_DELETE_BLOCKERS.MEMBERS])(
      'asks only to deactivate when its modal offered only that (%s)',
      async (blocker) => {
        // The server never does more than this: a blocker that has since
        // gone does not turn «غیرفعال» into a delete.
        delData.mockResolvedValue({ outcome: DELETE_OUTCOMES.DEACTIVATED });
        renderButton(blocker);
        await open();

        await confirm('admin-panel-products-deactivate-confirm');

        expect(delData).toHaveBeenCalledWith(
          sentWith(DELETE_INTENTS.DEACTIVATE),
        );
        expect(toast.warning).not.toHaveBeenCalled();
        expect(refresh).toHaveBeenCalledTimes(1);
      },
    );

    it('reports a transport failure as the retry advice, with the button usable again', async () => {
      delData.mockRejectedValue(new Error('network down'));
      renderButton(null);
      await open();

      await confirm();

      expect(toast.error).toHaveBeenCalledWith(
        'حذف محصول ناموفق بود. دوباره تلاش کن.',
      );
      expect(refresh).not.toHaveBeenCalled();
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: `حذف ${TITLE}` })
          .disabled,
      ).toBe(false);
    });

    it('shows the server’s own refusal instead of the retry advice', async () => {
      const refusal =
        'این محصول ۲ زیرمجموعه فعال دارد؛ اول آن‌ها را جابه‌جا یا غیرفعال کن.';
      delData.mockRejectedValue(new ApiRequestError(409, refusal));
      renderButton(HARD_DELETE_BLOCKERS.MEMBERS);
      await open();

      await confirm('admin-panel-products-deactivate-confirm');

      // A family head names how many members block it, and retrying can never
      // clear that — «دوباره تلاش کن» would send the admin round a loop that
      // cannot end. The generic sentence stays for transport failures, where
      // retrying is the right advice (the test above).
      expect(toast.error).toHaveBeenCalledWith(refusal);
    });
  });
});
