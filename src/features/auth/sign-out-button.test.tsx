// Pins what signing out leaves in the tab: none of the checkout's kept
// Idempotency-Keys, which belong to the shopper who signed out.
//
// Mocked at the module edge only: Better Auth's client and `next/navigation`.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CHECKOUT_KEY_STORAGE } from '@/features/checkout/checkout-key';
import { PATHS } from '@/lib/constant/paths';
import { SignOutButton } from './sign-out-button';

const { signOut, push, refresh } = vi.hoisted(() => ({
  signOut: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/lib/auth/client', () => ({ authClient: { signOut } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

it('forgets the checkout keys kept in this tab', async () => {
  signOut.mockResolvedValue({ data: { success: true }, error: null });
  window.sessionStorage.setItem(
    CHECKOUT_KEY_STORAGE,
    JSON.stringify([
      {
        digest: 'a'.repeat(64),
        key: '33333333-3333-4333-8333-333333333333',
        at: Date.now(),
      },
    ]),
  );
  render(<SignOutButton page="account" />);

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'خروج از حساب' }));
  });

  expect(signOut).toHaveBeenCalledTimes(1);
  expect(window.sessionStorage.getItem(CHECKOUT_KEY_STORAGE)).toBeNull();
  expect(push).toHaveBeenCalledWith(PATHS.HOME);
});
