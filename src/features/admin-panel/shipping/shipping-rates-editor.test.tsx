// Pins the rate editor's wiring — the carried-in security constraint stated as a
// test: saving a row is a SAME-ORIGIN PUT + JSON to /api/shipping/rates/{id}, not
// a POST or a form-encoded alias (the CSRF defences depend on it). `fetch` is
// mocked at the module edge so the real request shape — method, content-type,
// URL, body — is asserted, and `putData`'s envelope handling runs for real.
//
// Also pins the corrected contract: zero is a VALID (free) rate, unlike the
// design prototype's `> 0` check.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiShippingRatePath } from '@/lib/constant/paths';
import { ShippingRatesEditor } from './shipping-rates-editor';

const RATES = [
  { provinceId: 1, name: 'تهران', fee: 25_000 },
  { provinceId: 7, name: 'اصفهان', fee: 42_000 },
];

const okEnvelope = (fee: number, provinceId = 1, name = 'تهران') =>
  ({
    ok: true,
    json: async () => ({ status: 'success', data: { provinceId, name, fee } }),
  }) as Response;

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
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
});
