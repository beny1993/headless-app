import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api-client';
import { AccountView } from './account-view';
import type { AddressResponse } from '@/lib/hono/routes/me-addresses';

const { postData, patchData, delData } = vi.hoisted(() => ({
  postData: vi.fn(),
  patchData: vi.fn(),
  delData: vi.fn(),
}));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  postData,
  patchData,
  delData,
}));
vi.mock('@/features/auth/sign-out-button', () => ({
  SignOutButton: () => null,
}));
const address: AddressResponse = {
  id: 'address-1',
  title: 'خانه',
  recipientName: 'سارا',
  recipientPhone: '+989121234567',
  provinceId: 1,
  provinceName: 'تهران',
  city: 'تهران',
  postalCode: '1234567890',
  addressLine: 'خیابان آزادی پلاک یک',
  createdAt: '2026-09-01T00:00:00Z',
};
const click = (event: string) =>
  fireEvent.click(document.querySelector(`[data-umami-event="${event}"]`)!);
const show = () =>
  render(
    <AccountView
      name="سارا"
      phone="+989121234567"
      orders={[]}
      addresses={[address]}
      provinces={[{ provinceId: 1, name: 'تهران' }]}
    />,
  );
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('account resource state', () => {
  // One resource today; the tests stay written per resource so a second
  // owner-scoped tab drops in beside it.
  const resource = 'addresses';

  it(`${resource}: keeps a newly created record after switching tabs`, async () => {
    postData.mockResolvedValue({
      ...address,
      id: 'address-2',
      recipientName: 'جدید',
    });
    show();
    click(`account-tab-${resource}`);
    click(`account-${resource}-add`);
    const values = {
      'addresses-recipient-name': 'جدید',
      'addresses-recipient-phone': '+989121234567',
      'addresses-city': 'تهران',
      'addresses-postal': '1234567890',
      'addresses-line': 'خیابان آزادی پلاک یک',
    };
    for (const [field, value] of Object.entries(values)) {
      fireEvent.change(
        document.querySelector(`[data-umami-event="account-${field}"]`)!,
        { target: { value } },
      );
    }
    fireEvent.change(screen.getByLabelText('استان'), {
      target: { value: '1' },
    });
    await act(async () => {
      click(`account-${resource}-save`);
    });
    expect(postData).toHaveBeenCalledOnce();
    click('account-tab-profile');
    click(`account-tab-${resource}`);
    expect(screen.getByText('جدید · تهران')).toBeTruthy();
  });
  it(`${resource}: a failed deletion preserves the item and its open editor`, async () => {
    // The server's own refusal is what reaches the alert; a 5xx or a dead
    // connection would read the generic sentence instead.
    delData.mockRejectedValue(new ApiRequestError(409, 'حذف انجام نشد.'));
    show();
    click(`account-tab-${resource}`);
    click(`account-${resource}-edit`);
    click(`account-${resource}-delete`);
    await act(async () => {
      click(`account-${resource}-delete-confirm`);
    });
    expect(screen.getByRole('alert').textContent).toBe('حذف انجام نشد.');
    expect(
      document.querySelector(`[data-umami-event="account-${resource}-save"]`),
    ).not.toBeNull();
    expect(
      document.querySelector(`[data-umami-event="account-${resource}-edit"]`),
    ).not.toBeNull();
  });
  it(`${resource}: keeps a deletion after switching tabs`, async () => {
    delData.mockResolvedValue({ id: address.id });
    show();
    click(`account-tab-${resource}`);
    click(`account-${resource}-delete`);
    await act(async () => {
      click(`account-${resource}-delete-confirm`);
    });
    click('account-tab-profile');
    click(`account-tab-${resource}`);
    expect(
      document.querySelector(`[data-umami-event="account-${resource}-edit"]`),
    ).toBeNull();
  });
  it(`${resource}: deleting the item being edited closes its form`, async () => {
    delData.mockResolvedValue({});
    show();
    click(`account-tab-${resource}`);
    click(`account-${resource}-edit`);
    click(`account-${resource}-delete`);
    await act(async () => {
      click(`account-${resource}-delete-confirm`);
    });
    expect(
      document.querySelector(`[data-umami-event="account-${resource}-save"]`),
    ).toBeNull();
    expect(screen.getByText('هنوز آدرسی ذخیره نکرده‌ای')).toBeTruthy();
  });
  it(`${resource}: keeps an edit after switching tabs`, async () => {
    patchData.mockResolvedValue({ ...address, recipientName: 'جدید' });
    show();
    click(`account-tab-${resource}`);
    click(`account-${resource}-edit`);
    fireEvent.change(
      document.querySelector(
        '[data-umami-event="account-addresses-recipient-name"]',
      )!,
      { target: { value: 'جدید' } },
    );
    await act(async () => {
      click(`account-${resource}-save`);
    });
    click('account-tab-profile');
    click(`account-tab-${resource}`);
    expect(screen.getByText('جدید · تهران')).toBeTruthy();
  });
});
