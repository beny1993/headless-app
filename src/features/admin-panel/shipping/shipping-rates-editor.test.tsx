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
//
// And the one-fee-for-all control: a confirmed apply is one PUT + JSON to
// /api/admin/provinces/fee, and the table then shows what the server stored. That
// last part is a state-sync pin — each row seeds its input and its "saved" fee
// from props ONCE, so without a remount the table keeps showing the old fees
// over a database that no longer holds them.
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_PATHS,
  apiAdminProvincePath,
  apiShippingRatePath,
} from '@/lib/constant/paths';
import { formatNumber, formatToman } from '@/lib/format';
import { PROVINCE_MESSAGES } from '@/lib/shipping/province-input';
import { ShippingRatesEditor } from './shipping-rates-editor';

const { toast } = vi.hoisted(() => ({ toast: { error: vi.fn() } }));
vi.mock('sonner', () => ({ toast }));

const RATES = [
  { provinceId: 1, name: 'تهران', fee: 25_000, isActive: true },
  { provinceId: 7, name: 'اصفهان', fee: 42_000, isActive: true },
];

const DEACTIVATE = 'غیرفعال\u200Cسازی';
const BULK_LABEL = 'هزینه ارسال همه استان\u200Cها (تومان)';
const APPLY_ALL = 'اعمال روی همه استان\u200Cها';
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

    // The create form shows no preview of the parsed fee, so a dot-grouped
    // 25.000 read as 25 would be charged at checkout unseen.
    it('refuses a fee typed as 25.000 instead of saving 25 Toman', () => {
      render(<ShippingRatesEditor rates={RATES} />);

      fireEvent.change(nameInput(), { target: { value: 'یزد' } });
      fireEvent.change(newFeeInput(), { target: { value: '25.000' } });
      fireEvent.click(addButton());

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

  describe('one fee for every province', () => {
    const bulkInput = () =>
      screen.getByLabelText(BULK_LABEL) as HTMLInputElement;
    const applyButton = () => screen.getByRole('button', { name: APPLY_ALL });
    const saveButton = (index: number) =>
      screen.getAllByRole('button', { name: 'ذخیره' })[
        index
      ] as HTMLButtonElement;
    const confirmWith = (answer: boolean) => {
      const confirm = vi.fn(() => answer);
      vi.stubGlobal('confirm', confirm);
      return confirm;
    };
    const allAt = (fee: number) =>
      envelope([
        { ...RATES[0], fee },
        { ...RATES[1], fee, isActive: false },
      ]);
    const apply = async (typed: string) => {
      fireEvent.change(bulkInput(), { target: { value: typed } });
      fireEvent.click(applyButton());
      await act(async () => {});
    };

    it('PUTs the fee once, as same-origin JSON, to the bulk endpoint after a confirm', async () => {
      const confirm = confirmWith(true);
      fetchMock.mockResolvedValue(allAt(30_000));
      render(<ShippingRatesEditor rates={RATES} />);

      await apply('۳۰۰۰۰');

      // The confirm names what is about to be overwritten: how many, and to what.
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm).toHaveBeenCalledWith(
        expect.stringContaining(formatToman(30_000)),
      );
      expect(confirm).toHaveBeenCalledWith(
        expect.stringContaining(formatNumber(RATES.length)),
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('PUT');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({ fee: 30_000 });
      const parsed = new URL(url);
      expect(parsed.origin).toBe(window.location.origin);
      expect(parsed.pathname).toBe(API_PATHS.ADMIN_PROVINCES_FEE);
    });

    it('shows the stored fee in every row afterwards — typed-but-unsaved edits included', async () => {
      confirmWith(true);
      fetchMock.mockResolvedValue(allAt(30_000));
      render(<ShippingRatesEditor rates={RATES} />);
      fireEvent.change(feeInput('تهران'), { target: { value: '99999' } });

      await apply('30000');

      expect(feeInput('تهران').value).toBe('30000');
      expect(feeInput('اصفهان').value).toBe('30000');
      // Not dirty: the row's "saved" fee moved with it, not just its text.
      expect(saveButton(0).disabled).toBe(true);
      expect(saveButton(1).disabled).toBe(true);
      // The rest of the row is the server's too: اصفهان came back inactive.
      expect(feeInput('اصفهان').closest('tr')!.className).toContain(
        'opacity-60',
      );
      expect(bulkInput().value).toBe('');
    });

    it('resyncs a row back to a fee it started with', async () => {
      // تهران: 25,000 → saved per-row as 30,000 → every province back to 25,000.
      // The parent's copy of the row never heard about the per-row save, so its
      // fee is 25,000 before AND after the bulk write: a remount keyed on the fee
      // would see nothing change and leave 30,000 on screen.
      confirmWith(true);
      fetchMock.mockResolvedValueOnce(okEnvelope(30_000));
      render(<ShippingRatesEditor rates={RATES} />);
      fireEvent.change(feeInput('تهران'), { target: { value: '30000' } });
      fireEvent.click(saveButton(0));
      await act(async () => {});
      expect(feeInput('تهران').value).toBe('30000');

      fetchMock.mockResolvedValueOnce(allAt(25_000));
      await apply('25000');

      expect(feeInput('تهران').value).toBe('25000');
      expect(saveButton(0).disabled).toBe(true);
    });

    it('accepts zero — free shipping everywhere', async () => {
      confirmWith(true);
      fetchMock.mockResolvedValue(allAt(0));
      render(<ShippingRatesEditor rates={RATES} />);

      await apply('0');

      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ fee: 0 });
      expect(feeInput('تهران').value).toBe('0');
    });

    it('sends nothing when the confirm is cancelled, and keeps what was typed', async () => {
      confirmWith(false);
      render(<ShippingRatesEditor rates={RATES} />);

      await apply('30000');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(feeInput('تهران').value).toBe('25000');
      expect(bulkInput().value).toBe('30000');
    });

    it.each([
      ['an empty fee', ''],
      ['a negative fee', '-5'],
      ['a fractional fee', '1500.5'],
      ['a dot-grouped fee', '25.000'],
      ['text', 'abc'],
    ])(
      'shows the Persian fee error for %s, without asking or sending',
      async (_label, typed) => {
        const confirm = confirmWith(true);
        render(<ShippingRatesEditor rates={RATES} />);

        await apply(typed);

        expect(screen.getByText(PROVINCE_MESSAGES.fee)).toBeTruthy();
        expect(bulkInput().getAttribute('aria-invalid')).toBe('true');
        expect(confirm).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it('reports a refused apply as an error toast and leaves the rows alone', async () => {
      confirmWith(true);
      fetchMock.mockResolvedValue(errorEnvelope(403, 'دسترسی ندارید.'));
      render(<ShippingRatesEditor rates={RATES} />);

      await apply('30000');

      expect(toast.error).toHaveBeenCalledWith('دسترسی ندارید.');
      expect(feeInput('تهران').value).toBe('25000');
      expect(feeInput('اصفهان').value).toBe('42000');
    });

    it('is not offered when there is no province to apply it to', () => {
      render(<ShippingRatesEditor rates={[]} />);

      expect(screen.queryByRole('button', { name: APPLY_ALL })).toBeNull();
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
