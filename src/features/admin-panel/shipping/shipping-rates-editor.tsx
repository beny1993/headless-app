'use client';

import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ShippingRateRow } from '@/db/dao/ShippingRateDao';
import { putData } from '@/lib/api-client';
import { apiShippingRatePath } from '@/lib/constant/paths';
import { formatToman, toAsciiDigits } from '@/lib/format';
import { shippingFeeSchema } from '@/lib/shipping/shipping-query';
import { cn } from '@/lib/utils';

/**
 * The province rate table, each row inline-editable. Saving one row is a
 * same-origin `PUT` + JSON to `PUT /api/shipping/rates/{provinceId}` — the exact
 * contract the province-shipping security pass fixed in place: no POST/form alias
 * and no permissive CORS, because the CSRF defences (the JSON preflight and
 * SameSite=Lax) both depend on it. Client-side gating here is cosmetic; the real
 * boundary is `requireAdmin` on that endpoint.
 *
 * Validation reuses `shippingFeeSchema` — the same contract the API enforces — so
 * the two cannot drift: an integer ≥ 0, where **zero is a valid (free) rate**.
 * A Persian-keyboard entry is normalised with `toAsciiDigits` before parsing.
 */
export function ShippingRatesEditor({ rates }: { rates: ShippingRateRow[] }) {
  return (
    <div className="border-border overflow-hidden rounded-2xl border bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr>
              <th className="text-muted-foreground px-4 py-3 text-start font-semibold">
                استان
              </th>
              <th className="text-muted-foreground px-4 py-3 text-start font-semibold">
                هزینه ارسال (تومان)
              </th>
              <th className="text-muted-foreground px-4 py-3 text-start font-semibold">
                پیش‌نمایش
              </th>
              <th className="text-muted-foreground px-4 py-3 text-start font-semibold">
                <span className="sr-only">ذخیره</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rates.map((rate) => (
              <RateRow key={rate.provinceId} rate={rate} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RateRow({ rate }: { rate: ShippingRateRow }) {
  const [value, setValue] = useState(String(rate.fee));
  const [savedFee, setSavedFee] = useState(rate.fee);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const ascii = toAsciiDigits(value.trim());
  // Require at least one digit (rejects empty/negative/decimal), then the shared
  // schema — which allows 0. So `fee` is null exactly when the entry is invalid.
  const parsed = /^\d+$/.test(ascii)
    ? shippingFeeSchema.safeParse(Number(ascii))
    : null;
  const fee = parsed?.success ? parsed.data : null;
  const invalid = fee === null;
  const dirty = fee !== null && fee !== savedFee;

  const save = async () => {
    if (fee === null) return;
    setBusy(true);
    setJustSaved(false);
    try {
      const updated = await putData<ShippingRateRow>(
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

  const inputId = `rate-${rate.provinceId}`;
  return (
    <tr className="border-border border-t">
      <td className="px-4 py-2.5 font-medium">{rate.name}</td>
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
