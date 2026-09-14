// Pins the rate editor's wiring — the carried-in security constraint stated as a
// test: saving a row is a SAME-ORIGIN PUT + JSON to /api/shipping/rates/{id}, not
// a POST or a form-encoded alias (the CSRF defences depend on it). `fetch` is
// mocked at the module edge so the real request shape — method, content-type,
// URL, body — is asserted, and `putData`'s envelope handling runs for real.
//
// Also pins the corrected contract: zero is a VALID (free) rate, unlike the
// design prototype's `> 0` check.
//
// And the province management wiring (`Story - Admin Province Management`): the
// create form POSTs JSON to /api/admin/provinces and appends the row; the toggle
// PATCHes `{ isActive }` and mutes the row in place (fee still editable); zero
// provinces renders the empty state, not a bare header.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_PATHS,
  apiAdminProvincePath,
  apiShippingRatePath,
} from '@/lib/constant/paths';
import { PROVINCE_MESSAGES } from '@/lib/shipping/province-input';
import { ShippingRatesEditor } from './shipping-rates-editor';

const { toast } = vi.hoisted(() => ({ toast: { error: vi.fn() } }));
vi.mock('sonner', () => ({ toast }));

const RATES = [
  { provinceId: 1, name: 'تهران', fee: 25_000, isActive: true },
  { provinceId: 7, name: 'اصفهان', fee: 42_000, isActive: true },
];

const DEACTIVATE = 'غیرفعال\u200Cسازی';
const ACTIVATE = 'فعال\u200Cسازی';
const ARABIC_KAF = '\u0643';
const PERSIAN_KEHEH = '\u06A9';

const envelope = (data: unknown) =>
  ({
    ok: true,
    json: async () => ({ status: 'success', data }),
  }) as Response;

const okEnvelope = (fee: number, provinceId = 1, name = 'تهران') =>
  envelope({ provinceId, name, fee, isActive: true });

const errorEnvelope = (status: number, message: string) =>
  ({
    ok: false,
    status,
    json: async () => ({ status: 'error', message }),
  }) as Response;

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  toast.error.mockReset();
  vi.unstubAllGlobals();
});

const feeInput = (name: string) =>
  screen.getByLabelText(`هزینه ارسال ${name}`) as HTMLInputElement;

describe('ShippingRatesEditor', () => {
  it('renders a row per province with the fee prefilled', () => {
    render(<ShippingRatesEditor rates={RATES} />);
    expect(feeInput('تهران').value).toBe('25000');
    expect(feeInput('اصفهان').value).toBe('42000');
  });

  it('saves an edited fee as a same-origin PUT + JSON to the province endpoint', async () => {
    fetchMock.mockResolvedValue(okEnvelope(30_000));
    render(<ShippingRatesEditor rates={RATES} />);

    fireEvent.change(feeInput('تهران'), { target: { value: '30000' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'ذخیره' })[0]);
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('PUT');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ fee: 30_000 });
    // Same-origin, and the province-scoped path — no cross-origin, no alias.
    const parsed = new URL(url);
    expect(parsed.origin).toBe(window.location.origin);
    expect(parsed.pathname).toBe(apiShippingRatePath(1));

    expect(await screen.findByText('ذخیره شد')).toBeTruthy();
  });

  it('normalises Persian digits before sending', async () => {
    fetchMock.mockResolvedValue(okEnvelope(45_000));
    render(<ShippingRatesEditor rates={RATES} />);

    fireEvent.change(feeInput('تهران'), { target: { value: '۴۵۰۰۰' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'ذخیره' })[0]);
    await act(async () => {});

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      fee: 45_000,
    });
  });

  it('accepts zero as a valid (free) rate', async () => {
    fetchMock.mockResolvedValue(okEnvelope(0));
    render(<ShippingRatesEditor rates={RATES} />);

    fireEvent.change(feeInput('تهران'), { target: { value: '0' } });
    const saveButton = screen.getAllByRole('button', { name: 'ذخیره' })[0];
    expect(saveButton.hasAttribute('disabled')).toBe(false);

    fireEvent.click(saveButton);
    await act(async () => {});
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ fee: 0 });
  });

  it('marks a non-numeric fee invalid and does not send it', () => {
    render(<ShippingRatesEditor rates={RATES} />);

    fireEvent.change(feeInput('تهران'), { target: { value: 'abc' } });
    expect(feeInput('تهران').getAttribute('aria-invalid')).toBe('true');
    expect(
      (screen.getAllByRole('button', { name: 'ذخیره' })[0] as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('create province', () => {
    const nameInput = () =>
      screen.getByLabelText('نام استان') as HTMLInputElement;
    const newFeeInput = () =>
      screen.getByLabelText('هزینه ارسال (تومان)') as HTMLInputElement;
    const addButton = () =>
      screen.getByRole('button', { name: 'افزودن استان' });
    const rowNames = () =>
      Array.from(document.querySelectorAll('tbody tr')).map(
        (row) => row.querySelector('td')?.textContent,
      );

    it('POSTs the normalized name and fee as same-origin JSON and appends the row', async () => {
      fetchMock.mockResolvedValue(
        envelope({
          provinceId: 40,
          name: `${PERSIAN_KEHEH}رمان`,
          fee: 35_000,
          isActive: true,
        }),
      );
      render(<ShippingRatesEditor rates={RATES} />);

      fireEvent.change(nameInput(), {
        target: { value: ` ${ARABIC_KAF}رمان ` },
      });
      fireEvent.change(newFeeInput(), { target: { value: '۳۵۰۰۰' } });
      fireEvent.click(addButton());
      await act(async () => {});

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({
        name: `${PERSIAN_KEHEH}رمان`,
        fee: 35_000,
      });
      const parsed = new URL(url);
      expect(parsed.origin).toBe(window.location.origin);
      expect(parsed.pathname).toBe(API_PATHS.ADMIN_PROVINCES);

      expect(rowNames()).toEqual(['تهران', 'اصفهان', `${PERSIAN_KEHEH}رمان`]);
      expect(nameInput().value).toBe('');
      expect(newFeeInput().value).toBe('');
    });

    it('creates the first province from the empty state', async () => {
      fetchMock.mockResolvedValue(
        envelope({ provinceId: 1, name: 'تهران', fee: 0, isActive: true }),
      );
      render(<ShippingRatesEditor rates={[]} />);

      fireEvent.change(nameInput(), { target: { value: 'تهران' } });
      fireEvent.change(newFeeInput(), { target: { value: '0' } });
      fireEvent.click(addButton());
      await act(async () => {});

      expect(rowNames()).toEqual(['تهران']);
    });

    it('shows Persian field errors and sends nothing for a blank name or a bad fee', () => {
      render(<ShippingRatesEditor rates={RATES} />);

      fireEvent.change(newFeeInput(), { target: { value: '-5' } });
      fireEvent.click(addButton());

      expect(screen.getByText(PROVINCE_MESSAGES.name)).toBeTruthy();
      expect(screen.getByText(PROVINCE_MESSAGES.fee)).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports a 409 duplicate as an error toast and keeps the input', async () => {
      fetchMock.mockResolvedValue(
        errorEnvelope(409, 'این استان غیرفعال است — فعالش کن'),
      );
      render(<ShippingRatesEditor rates={RATES} />);

      fireEvent.change(nameInput(), { target: { value: 'قم' } });
      fireEvent.change(newFeeInput(), { target: { value: '1000' } });
      fireEvent.click(addButton());
      await act(async () => {});

      expect(toast.error).toHaveBeenCalledWith(
        'این استان غیرفعال است — فعالش کن',
      );
      expect(nameInput().value).toBe('قم');
      expect(rowNames()).toEqual(['تهران', 'اصفهان']);
    });
  });

  describe('toggle province', () => {
    it('PATCHes isActive:false, mutes the row in place and offers reactivation', async () => {
      fetchMock.mockResolvedValue(
        envelope({
          provinceId: 1,
          name: 'تهران',
          fee: 25_000,
          isActive: false,
        }),
      );
      render(<ShippingRatesEditor rates={RATES} />);

      fireEvent.click(screen.getAllByRole('button', { name: DEACTIVATE })[0]);
      await act(async () => {});

      const [url, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body)).toEqual({ isActive: false });
      expect(new URL(url).pathname).toBe(apiAdminProvincePath(1));

      const row = feeInput('تهران').closest('tr')!;
      expect(row.className).toContain('opacity-60');
      expect(row.textContent).toContain(ACTIVATE);
      // Still first: in place, not regrouped.
      expect(document.querySelector('tbody tr')).toBe(row);
      // The fee stays editable on an inactive province.
      fireEvent.change(feeInput('تهران'), { target: { value: '30000' } });
      expect(
        (
          screen.getAllByRole('button', {
            name: 'ذخیره',
          })[0] as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    });

    it('reactivates an inactive row with isActive:true', async () => {
      fetchMock.mockResolvedValue(
        envelope({
          provinceId: 7,
          name: 'اصفهان',
          fee: 42_000,
          isActive: true,
        }),
      );
      render(
        <ShippingRatesEditor
          rates={[RATES[0], { ...RATES[1], isActive: false }]}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: ACTIVATE }));
      await act(async () => {});

      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        isActive: true,
      });
      expect(feeInput('اصفهان').closest('tr')!.className).not.toContain(
        'opacity-60',
      );
    });
  });

  it('renders a Persian empty state, not a bare header, with zero provinces', () => {
    render(<ShippingRatesEditor rates={[]} />);

    expect(
      screen.getByText(
        'هنوز استانی ثبت نشده است. اولین استان را با فرم بالا اضافه کن.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: 'افزودن استان' })).toBeTruthy();
  });

  it('reports a refused save as an error toast', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ status: 'error', message: 'دسترسی ندارید.' }),
    } as Response);
    render(<ShippingRatesEditor rates={RATES} />);

    fireEvent.change(feeInput('تهران'), { target: { value: '30000' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'ذخیره' })[0]);
    await act(async () => {});

    expect(toast.error).toHaveBeenCalledWith('دسترسی ندارید.');
    expect(screen.queryByText('ذخیره شد')).toBeNull();
  });
});
