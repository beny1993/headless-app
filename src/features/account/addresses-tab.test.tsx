// Pins the stale-province guard on the account address form. A controlled
// <select> whose value matches no option renders the first option while state
// keeps the stale id — so without the guard the customer sees a province they
// did not pick and saves straight into the API's 422. The form must say so in
// Persian and send nothing until another province is picked. Also pins the
// shared save path's refusal branch (`useFormState`): a 422's field entries land
// under their fields, the rest in the top alert, and the button comes back.
//
// Mocked at the module edge only: the `@/lib/api-client` writers (the real
// ApiRequestError is kept). Harness as in ./account-view.test.tsx.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddressesTab } from './addresses-tab';
import { ApiRequestError } from '@/lib/api-client';
import type { AddressResponse } from '@/lib/hono/routes/me-addresses';
import { STALE_PROVINCE_MESSAGE } from '@/lib/shipping/province-input';

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

/** Saved against «قم» (id 9), which the admin has since deactivated. */
const address: AddressResponse = {
  id: 'address-1',
  title: 'خانه',
  recipientName: 'سارا',
  recipientPhone: '+989121234567',
  provinceId: 9,
  provinceName: 'قم',
  city: 'قم',
  postalCode: '1234567890',
  addressLine: 'خیابان آزادی پلاک یک',
  createdAt: '2026-09-01T00:00:00Z',
};

const click = (event: string) =>
  fireEvent.click(document.querySelector(`[data-umami-event="${event}"]`)!);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AddressesTab — an address on a deactivated province', () => {
  it('warns on edit, sends nothing, and clears once another province is picked', async () => {
    patchData.mockResolvedValue({
      ...address,
      provinceId: 1,
      provinceName: 'تهران',
    });
    render(
      <AddressesTab
        addresses={[address]}
        onAddressesChange={vi.fn()}
        provinces={[{ provinceId: 1, name: 'تهران' }]}
      />,
    );

    // The saved card still shows its province (the address join is unfiltered)…
    expect(screen.getByText('خانه — قم')).toBeTruthy();

    // …and opening the editor says so at once, before any save attempt.
    click('account-addresses-edit');
    expect(screen.getByText(STALE_PROVINCE_MESSAGE)).toBeTruthy();
    // The select shows its placeholder, not «تهران»: with no matching option
    // React selects the first enabled one, and re-picking that displayed option
    // would fire no change — the warning could then never be cleared with it.
    expect((screen.getByLabelText('استان') as HTMLSelectElement).value).toBe(
      '',
    );

    await act(async () => {
      click('account-addresses-save');
    });
    expect(patchData).not.toHaveBeenCalled();
    expect(screen.getByText(STALE_PROVINCE_MESSAGE)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('استان'), {
      target: { value: '1' },
    });
    expect(screen.queryByText(STALE_PROVINCE_MESSAGE)).toBeNull();

    await act(async () => {
      click('account-addresses-save');
    });
    expect(patchData).toHaveBeenCalledOnce();
    expect(patchData.mock.calls[0][1]).toMatchObject({ provinceId: 1 });
  });

  it('shows no warning for an address on an active province', () => {
    render(
      <AddressesTab
        addresses={[address]}
        onAddressesChange={vi.fn()}
        provinces={[{ provinceId: 9, name: 'قم' }]}
      />,
    );

    click('account-addresses-edit');
    expect(screen.queryByText(STALE_PROVINCE_MESSAGE)).toBeNull();
  });
});

describe('AddressesTab — a save the server refuses', () => {
  it('shows the field error under its field, the rest on top, and frees the button', async () => {
    const cityError = 'نام شهر معتبر نیست.';
    const unmapped = 'این آدرس دیگر قابل ویرایش نیست.';
    patchData.mockRejectedValue(
      new ApiRequestError(422, 'Unprocessable', [
        `city: ${cityError}`,
        unmapped,
      ]),
    );
    const onAddressesChange = vi.fn();
    render(
      <AddressesTab
        addresses={[address]}
        onAddressesChange={onAddressesChange}
        provinces={[{ provinceId: 9, name: 'قم' }]}
      />,
    );

    click('account-addresses-edit');
    await act(async () => {
      click('account-addresses-save');
    });

    expect(patchData).toHaveBeenCalledOnce();
    expect(onAddressesChange).not.toHaveBeenCalled();
    expect(document.getElementById('addr-city-error')?.textContent).toContain(
      cityError,
    );
    expect(screen.getByLabelText('شهر').getAttribute('aria-describedby')).toBe(
      'addr-city-error',
    );
    expect(screen.getByText(unmapped).getAttribute('role')).toBe('alert');
    const save = document.querySelector<HTMLButtonElement>(
      '[data-umami-event="account-addresses-save"]',
    )!;
    expect(save.disabled).toBe(false);
    expect(save.textContent).toBe('ذخیره');
  });
});
