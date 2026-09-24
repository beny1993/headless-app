'use client';

import { useId, useState } from 'react';
import { Check, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminProvinceRow } from '@/db/dao/ShippingRateDao';
import { TextField } from '@/components/ui/field';
import {
  ApiRequestError,
  patchData,
  postData,
  putData,
} from '@/lib/api-client';
import { parseFieldErrors } from '@/lib/checkout/field-errors';
import {
  API_PATHS,
  apiAdminProvincePath,
  apiShippingRatePath,
} from '@/lib/constant/paths';
import { formatNumber, formatToman, parseDigits } from '@/lib/format';
import {
  PROVINCE_MESSAGES,
  provinceCreateSchema,
} from '@/lib/shipping/province-input';
import { shippingFeeSchema } from '@/lib/shipping/shipping-query';
import { cn } from '@/lib/utils';

const DEACTIVATE_LABEL = 'غیرفعال\u200Cسازی';
const ACTIVATE_LABEL = 'فعال\u200Cسازی';
const BULK_FEE_LABEL = 'هزینه ارسال همه استان\u200Cها (تومان)';
const APPLY_ALL_LABEL = 'اعمال روی همه استان\u200Cها';

/**
 * A fee as typed — Persian or ASCII digits — to integer Toman, or `null` when it
 * is not one: blank, negative and fractional all fail the shared
 * `shippingFeeSchema`, which allows 0 (free shipping).
 */
const parseFee = (raw: string): number | null => {
  const parsed = shippingFeeSchema.safeParse(parseDigits(raw));
  return parsed.success ? parsed.data : null;
};

/**
 * The province rate page: a create form over the province table, each row's fee
 * inline-editable and each row activate/deactivate-able. Every write is a
 * same-origin JSON call — the rate `PUT /api/shipping/rates/{provinceId}` (the
 * exact contract the province-shipping security pass fixed in place: no
 * POST/form alias and no permissive CORS, because the CSRF defences — the JSON
 * preflight and SameSite=Lax — both depend on it), and `POST`/`PATCH` under
 * `/api/admin/provinces`, plus the one-fee-for-all `PUT /api/admin/provinces/fee`.
 * Client-side gating here is cosmetic; the real boundary is `requireAdmin` on
 * those endpoints.
 *
 * Validation reuses the shared contracts (`shippingFeeSchema`,
 * `provinceCreateSchema`), so the form and the API cannot drift. Rows live in
 * local state: a create appends (ids ascend, so id order holds), a toggle maps
 * in place — an inactive province stays where it was, muted, fee still editable.
 *
 * A bulk apply replaces the rows with the server's list AND bumps `generation`,
 * which is part of every row's key. Each `RateRow` seeds its input and its
 * "saved" fee from props once, so only a remount makes the table show what the
 * database now holds. Keyed on a counter rather than the fee: a per-row save
 * never reaches `rows`, so after 25,000 → 30,000 (saved in the row) → everything
 * back to 25,000, the fee in `rows` has not changed and would remount nothing.
 */
export function ShippingRatesEditor({ rates }: { rates: AdminProvinceRow[] }) {
  const [rows, setRows] = useState(rates);
  const [generation, setGeneration] = useState(0);

  const onCreated = (created: AdminProvinceRow) =>
    setRows((prev) => [...prev, created]);
  const onToggled = (updated: AdminProvinceRow) =>
    setRows((prev) =>
      prev.map((row) =>
        row.provinceId === updated.provinceId ? updated : row,
      ),
    );
  const onAppliedToAll = (updated: AdminProvinceRow[]) => {
    setRows(updated);
    setGeneration((current) => current + 1);
  };

  return (
    // `min-w-0`: a flex item holding a wide table (see the discount manager).
    <div className="flex min-w-0 flex-col gap-6">
      <CreateProvinceForm onCreated={onCreated} />
      {rows.length > 0 && (
        <BulkFeeForm count={rows.length} onApplied={onAppliedToAll} />
      )}
      {rows.length === 0 ? (
        <div className="border-border bg-secondary/40 text-muted-foreground rounded-2xl border py-16 text-center text-sm">
          هنوز استانی ثبت نشده است. اولین استان را با فرم بالا اضافه کن.
        </div>
      ) : (
        <div className="border-border overflow-hidden rounded-2xl border bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50">
                <tr>
                  <th className="text-muted-foreground px-4 py-3 text-start font-semibold">
                    استان
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-start font-semibold">
                    وضعیت
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-start font-semibold">
                    هزینه ارسال (تومان)
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-start font-semibold">
                    {'پیش\u200Cنمایش'}
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-start font-semibold">
                    <span className="sr-only">ذخیره و تغییر وضعیت</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((rate) => (
                  <RateRow
                    key={`${rate.provinceId}:${generation}`}
                    rate={rate}
                    onToggled={onToggled}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One fee for every province — what makes 31 rows tunable: set them all, then
 * adjust the few that differ. It overwrites every rate (inactive provinces too),
 * so the confirm says how many and to what before anything is sent; a cancelled
 * confirm keeps what was typed. The write is a single atomic server-side
 * `UPDATE`, never a loop of per-row PUTs from here that could stop half way.
 */
function BulkFeeForm({
  count,
  onApplied,
}: {
  count: number;
  onApplied: (updated: AdminProvinceRow[]) => void;
}) {
  const fieldId = useId();
  const [fee, setFee] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [justApplied, setJustApplied] = useState(false);

  const submit = async () => {
    if (busy) return;
    setError(undefined);
    setJustApplied(false);

    const value = parseFee(fee);
    if (value === null) {
      setError(PROVINCE_MESSAGES.fee);
      return;
    }
    if (
      !window.confirm(
        `هزینه ارسال هر ${formatNumber(count)} استان روی ${formatToman(value)} تنظیم می\u200Cشود و جای نرخ\u200Cهای فعلی را می\u200Cگیرد. ادامه؟`,
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      onApplied(
        await putData<AdminProvinceRow[]>(API_PATHS.ADMIN_PROVINCES_FEE, {
          fee: value,
        }),
      );
      setFee('');
      setJustApplied(true);
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : 'اعمال هزینه ناموفق بود. دوباره تلاش کن.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="border-border bg-card flex flex-col gap-4 rounded-2xl border p-6"
    >
      <h2 className="font-bold">{'یک هزینه برای همه استان\u200Cها'}</h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          id={`${fieldId}-bulk-fee`}
          label={BULK_FEE_LABEL}
          value={fee}
          onChange={(next) => {
            setFee(next);
            setJustApplied(false);
          }}
          error={error}
          hint={
            'بعد از اعمال، استان\u200Cهای متفاوت را در جدول تک\u200Cتک تنظیم کن'
          }
          dir="ltr"
          inputMode="numeric"
          umami="admin-panel-shipping-bulk-fee"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          data-umami-event="admin-panel-shipping-bulk-apply"
          className="bg-accent-strong hover:bg-accent-hover inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          )}
          {APPLY_ALL_LABEL}
        </button>
        {justApplied && (
          <span className="text-success-strong flex items-center gap-1 text-sm">
            <Check size={16} aria-hidden="true" /> روی همه اعمال شد
          </span>
        )}
      </div>
    </form>
  );
}

function CreateProvinceForm({
  onCreated,
}: {
  onCreated: (created: AdminProvinceRow) => void;
}) {
  const fieldId = useId();
  const [name, setName] = useState('');
  const [fee, setFee] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [justCreated, setJustCreated] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setErrors({});
    setJustCreated(null);

    const feeValue = parseFee(fee);
    const parsed = provinceCreateSchema.safeParse({ name, fee: feeValue });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        next[String(issue.path[0])] ??= issue.message;
      }
      setErrors(next);
      return;
    }

    setBusy(true);
    try {
      const created = await postData<AdminProvinceRow>(
        API_PATHS.ADMIN_PROVINCES,
        parsed.data,
      );
      onCreated(created);
      setJustCreated(created.name);
      setName('');
      setFee('');
    } catch (error) {
      // A 400 carries `field: message` errors, shown by their fields; any other
      // failure (a 409 duplicate, 401/403, the network) is a request failure and
      // goes to a toast, like the rest of the admin panel.
      if (error instanceof ApiRequestError && error.status === 400) {
        const { fields, unmapped } = parseFieldErrors(error.errors);
        setErrors(fields);
        if (Object.keys(fields).length === 0) toast.error(error.message);
        else if (unmapped.length > 0) toast.error(unmapped.join(' '));
      } else {
        toast.error(
          error instanceof Error
            ? error.message
            : 'افزودن استان ناموفق بود. دوباره تلاش کن.',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="border-border bg-card flex flex-col gap-4 rounded-2xl border p-6"
    >
      <h2 className="font-bold">استان جدید</h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          id={`${fieldId}-name`}
          label="نام استان"
          value={name}
          onChange={setName}
          error={errors.name}
          dir="rtl"
          umami="admin-panel-shipping-province-name"
        />
        <TextField
          id={`${fieldId}-fee`}
          label="هزینه ارسال (تومان)"
          value={fee}
          onChange={setFee}
          error={errors.fee}
          hint="صفر یعنی ارسال رایگان"
          dir="ltr"
          inputMode="numeric"
          umami="admin-panel-shipping-province-fee"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          data-umami-event="admin-panel-shipping-province-create"
          className="bg-accent-strong hover:bg-accent-hover inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <Plus size={14} aria-hidden="true" />
          )}
          افزودن استان
        </button>
        {justCreated && (
          <span className="text-success-strong flex items-center gap-1 text-sm">
            <Check size={16} aria-hidden="true" /> استان «{justCreated}» اضافه
            شد
          </span>
        )}
      </div>
    </form>
  );
}

function RateRow({
  rate,
  onToggled,
}: {
  rate: AdminProvinceRow;
  onToggled: (updated: AdminProvinceRow) => void;
}) {
  const [value, setValue] = useState(String(rate.fee));
  const [savedFee, setSavedFee] = useState(rate.fee);
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const fee = parseFee(value);
  const invalid = fee === null;
  const dirty = fee !== null && fee !== savedFee;

  const save = async () => {
    if (fee === null) return;
    setBusy(true);
    setJustSaved(false);
    try {
      const updated = await putData<AdminProvinceRow>(
        apiShippingRatePath(rate.provinceId),
        { fee },
      );
      setSavedFee(updated.fee);
      setValue(String(updated.fee));
      setJustSaved(true);
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : 'ذخیره نرخ ناموفق بود. دوباره تلاش کن.',
      );
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      onToggled(
        await patchData<AdminProvinceRow>(
          apiAdminProvincePath(rate.provinceId),
          {
            isActive: !rate.isActive,
          },
        ),
      );
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : 'تغییر وضعیت ناموفق بود.',
      );
    } finally {
      setToggling(false);
    }
  };

  const inputId = `rate-${rate.provinceId}`;
  return (
    <tr
      className={cn('border-border border-t', !rate.isActive && 'opacity-60')}
    >
      <td className="px-4 py-2.5 font-medium">{rate.name}</td>
      <td className="px-4 py-2.5">
        {rate.isActive ? (
          <span className="text-success-strong bg-success-soft inline-flex rounded-full px-2.5 py-1 text-xs font-medium">
            فعال
          </span>
        ) : (
          <span className="text-muted-foreground bg-muted inline-flex rounded-full px-2.5 py-1 text-xs font-medium">
            غیرفعال
          </span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <label htmlFor={inputId} className="sr-only">
          هزینه ارسال {rate.name}
        </label>
        <input
          id={inputId}
          inputMode="numeric"
          dir="ltr"
          aria-invalid={invalid}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setJustSaved(false);
          }}
          className={cn(
            'nums bg-secondary w-36 rounded-lg border px-3 py-2 text-start transition-colors outline-none focus-visible:ring-2',
            invalid
              ? 'border-destructive bg-destructive-soft/40'
              : 'border-border focus-visible:border-accent-strong',
          )}
        />
      </td>
      <td className="text-muted-foreground nums px-4 py-2.5">
        {invalid ? (
          <span className="text-destructive">نامعتبر</span>
        ) : (
          formatToman(fee)
        )}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={invalid || !dirty || busy}
            data-umami-event="admin-panel-shipping-save"
            className="bg-accent-strong hover:bg-accent-hover inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && (
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            )}
            ذخیره
          </button>
          <button
            type="button"
            onClick={toggle}
            disabled={toggling}
            data-umami-event="admin-panel-shipping-province-toggle"
            className="border-border hover:bg-secondary inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {toggling && (
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            )}
            {rate.isActive ? DEACTIVATE_LABEL : ACTIVATE_LABEL}
          </button>
          {justSaved && !dirty && (
            <span className="text-success-strong flex items-center gap-1 text-xs">
              <Check size={14} aria-hidden="true" /> ذخیره شد
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
