'use client';

import { useId, useState } from 'react';
import { AlertCircle, Check, Loader2, Plus, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { ApiRequestError, patchData, postData } from '@/lib/api-client';
import { parseFieldErrors } from '@/lib/checkout/field-errors';
import { API_PATHS, apiAdminDiscountPath } from '@/lib/constant/paths';
import {
  DISCOUNT_TYPES,
  type DiscountType,
  discountCodeInputSchema,
} from '@/lib/discount/discount-code';
import {
  formatJalali,
  formatToman,
  toAsciiDigits,
  toPersianDigits,
} from '@/lib/format';
import type { DiscountCodeView } from '@/lib/hono/routes/admin-discounts';
import { cn } from '@/lib/utils';

/**
 * The admin discount-code manager: a create form over a live list, each row
 * activate/deactivate-able. Creating and toggling are same-origin JSON calls to
 * the `/api/admin/*` routes behind `requireAdmin` — the client gating here is
 * cosmetic, the real boundary is that guard. Validation reuses the shared
 * `discountCodeInputSchema`, so the form and the API cannot drift; a bad body
 * still gets the server's Persian field errors back.
 *
 * Codes are order-snapshotted (amount + string), so there is no delete — the
 * lifecycle control is the active toggle.
 */
export function DiscountManager({
  initialCodes,
}: {
  initialCodes: DiscountCodeView[];
}) {
  const [codes, setCodes] = useState(initialCodes);

  const onCreated = (created: DiscountCodeView) =>
    setCodes((prev) => [created, ...prev]);
  const onToggled = (updated: DiscountCodeView) =>
    setCodes((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));

  return (
    // `min-w-0`: this is a flex item (of the page's flex column) that contains a
    // wide table. Without it the item's `min-width:auto` grows to the table's
    // intrinsic width and the table's `overflow-x-auto` wrapper never scrolls —
    // pushing the whole admin page off-screen at narrow widths.
    <div className="flex min-w-0 flex-col gap-6">
      <CreateForm onCreated={onCreated} />
      <CodeTable codes={codes} onToggled={onToggled} />
    </div>
  );
}

function CreateForm({
  onCreated,
}: {
  onCreated: (created: DiscountCodeView) => void;
}) {
  const fieldId = useId();
  const [code, setCode] = useState('');
  const [type, setType] = useState<DiscountType>(DISCOUNT_TYPES.PERCENT);
  const [value, setValue] = useState('');
  const [minOrderAmount, setMinOrderAmount] = useState('');
  const [usageLimit, setUsageLimit] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [justCreated, setJustCreated] = useState<string | null>(null);

  const reset = () => {
    setCode('');
    setValue('');
    setMinOrderAmount('');
    setUsageLimit('');
    setExpiresAt('');
  };

  const asNumber = (raw: string): number | undefined => {
    const ascii = toAsciiDigits(raw.trim());
    return ascii === '' ? undefined : Number(ascii);
  };

  const submit = async () => {
    if (busy) return;
    setErrors({});
    setJustCreated(null);

    // Build the body with the shared contract's shape; client-validate for inline
    // errors, then let the server re-validate authoritatively.
    const candidate = {
      code: code.trim(),
      type,
      value: asNumber(value),
      minOrderAmount: asNumber(minOrderAmount) ?? 0,
      usageLimit: asNumber(usageLimit) ?? null,
      expiresAt: expiresAt.trim() === '' ? null : expiresAt.trim(),
      isActive: true,
    };

    const parsed = discountCodeInputSchema.safeParse(candidate);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '');
        if (key && !(key in next)) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }

    setBusy(true);
    try {
      const created = await postData<DiscountCodeView>(
        API_PATHS.ADMIN_DISCOUNTS,
        candidate,
      );
      onCreated(created);
      setJustCreated(created.code);
      reset();
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 400) {
        const { fields, unmapped } = parseFieldErrors(error.errors);
        setErrors(fields);
        if (Object.keys(fields).length === 0) toast.error(error.message);
        else if (unmapped.length > 0) toast.error(unmapped.join(' '));
      } else {
        toast.error(
          error instanceof Error
            ? error.message
            : 'ساخت کد تخفیف ناموفق بود. دوباره تلاش کن.',
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
      <div className="flex items-center gap-2">
        <Tag size={18} className="text-accent-strong" aria-hidden="true" />
        <h2 className="font-bold">ساخت کد تخفیف</h2>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          id={`${fieldId}-code`}
          label="کد"
          value={code}
          onChange={setCode}
          error={errors.code}
          dir="ltr"
          placeholder="مثل NOWRUZ1405"
          umami="admin-panel-discount-code"
        />

        <div>
          <label
            htmlFor={`${fieldId}-type`}
            className="mb-1.5 block text-sm font-medium"
          >
            نوع تخفیف
          </label>
          <select
            id={`${fieldId}-type`}
            value={type}
            onChange={(event) => setType(event.target.value as DiscountType)}
            className="bg-secondary focus-visible:border-accent-strong border-border h-12 w-full rounded-xl border px-4 transition-colors outline-none focus-visible:ring-2"
            data-umami-event="admin-panel-discount-type"
          >
            <option value={DISCOUNT_TYPES.PERCENT}>درصدی</option>
            <option value={DISCOUNT_TYPES.FIXED}>مبلغی (تومان)</option>
          </select>
        </div>

        <Field
          id={`${fieldId}-value`}
          label={
            type === DISCOUNT_TYPES.PERCENT ? 'درصد (۱ تا ۱۰۰)' : 'مبلغ (تومان)'
          }
          value={value}
          onChange={setValue}
          error={errors.value}
          dir="ltr"
          inputMode="numeric"
          umami="admin-panel-discount-value"
        />

        <Field
          id={`${fieldId}-min`}
          label="حداقل مبلغ سفارش (تومان)"
          value={minOrderAmount}
          onChange={setMinOrderAmount}
          error={errors.minOrderAmount}
          dir="ltr"
          inputMode="numeric"
          hint="خالی یعنی بدون حداقل"
          umami="admin-panel-discount-min"
        />

        <Field
          id={`${fieldId}-limit`}
          label="سقف استفاده"
          value={usageLimit}
          onChange={setUsageLimit}
          error={errors.usageLimit}
          dir="ltr"
          inputMode="numeric"
          hint="خالی یعنی نامحدود"
          umami="admin-panel-discount-limit"
        />

        <div>
          <label
            htmlFor={`${fieldId}-expires`}
            className="mb-1.5 block text-sm font-medium"
          >
            تاریخ انقضا
          </label>
          <input
            id={`${fieldId}-expires`}
            type="date"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            dir="ltr"
            className={cn(
              'bg-secondary focus-visible:border-accent-strong h-12 w-full rounded-xl border px-4 text-start transition-colors outline-none focus-visible:ring-2',
              errors.expiresAt ? 'border-destructive' : 'border-border',
            )}
            data-umami-event="admin-panel-discount-expires"
          />
          <p className="text-muted-foreground mt-1.5 text-xs">
            خالی یعنی بدون انقضا
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          data-umami-event="admin-panel-discount-create"
          className="bg-accent-strong hover:bg-accent-hover inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <Plus size={14} aria-hidden="true" />
          )}
          ساخت کد
        </button>
        {justCreated && (
          <span className="text-success-strong flex items-center gap-1 text-sm">
            <Check size={16} aria-hidden="true" /> کد «{justCreated}» ساخته شد
          </span>
        )}
      </div>
    </form>
  );
}

function CodeTable({
  codes,
  onToggled,
}: {
  codes: DiscountCodeView[];
  onToggled: (updated: DiscountCodeView) => void;
}) {
  if (codes.length === 0) {
    return (
      <div className="border-border bg-secondary/40 text-muted-foreground rounded-2xl border py-16 text-center text-sm">
        هنوز کد تخفیفی ساخته نشده است.
      </div>
    );
  }

  return (
    <div className="border-border overflow-hidden rounded-2xl border bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr>
              {[
                'کد',
                'تخفیف',
                'حداقل سفارش',
                'استفاده',
                'انقضا',
                'وضعیت',
                '',
              ].map((heading, index) => (
                <th
                  key={heading || `action-${index}`}
                  className="text-muted-foreground px-4 py-3 text-start font-semibold"
                >
                  {heading || <span className="sr-only">تغییر وضعیت</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {codes.map((code) => (
              <CodeRow key={code.id} code={code} onToggled={onToggled} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CodeRow({
  code,
  onToggled,
}: {
  code: DiscountCodeView;
  onToggled: (updated: DiscountCodeView) => void;
}) {
  const [busy, setBusy] = useState(false);

  const discountLabel =
    code.type === DISCOUNT_TYPES.PERCENT
      ? `${toPersianDigits(code.value)}٪`
      : formatToman(code.value);

  const usageLabel =
    code.usageLimit === null
      ? `${toPersianDigits(code.usageCount)} / نامحدود`
      : `${toPersianDigits(code.usageCount)} / ${toPersianDigits(code.usageLimit)}`;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await patchData<DiscountCodeView>(
        apiAdminDiscountPath(code.id),
        { isActive: !code.isActive },
      );
      onToggled(updated);
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : 'تغییر وضعیت ناموفق بود.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr
      className={cn('border-border border-t', !code.isActive && 'opacity-60')}
    >
      <td className="px-4 py-3 font-mono font-medium" dir="ltr">
        {code.code}
      </td>
      <td className="nums px-4 py-3">{discountLabel}</td>
      <td className="nums text-muted-foreground px-4 py-3">
        {code.minOrderAmount === 0 ? '—' : formatToman(code.minOrderAmount)}
      </td>
      <td className="nums px-4 py-3">{usageLabel}</td>
      <td className="text-muted-foreground px-4 py-3">
        {code.expiresAt ? formatJalali(new Date(code.expiresAt)) : 'بدون انقضا'}
      </td>
      <td className="px-4 py-3">
        {code.isActive ? (
          <span className="text-success-strong bg-success-soft inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium">
            فعال
          </span>
        ) : (
          <span className="text-muted-foreground bg-muted inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium">
            غیرفعال
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            data-umami-event="admin-panel-discount-toggle"
            className="border-border hover:bg-secondary inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && (
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            )}
            {code.isActive ? 'غیرفعال کن' : 'فعال کن'}
          </button>
        </div>
      </td>
    </tr>
  );
}

/** One labelled text input with an inline error, matching the shipping editor. */
function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  dir,
  inputMode,
  placeholder,
  umami,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  dir?: 'ltr' | 'rtl';
  inputMode?: 'text' | 'numeric';
  placeholder?: string;
  umami: string;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="text"
        dir={dir}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className={cn(
          'bg-secondary focus-visible:border-accent-strong h-12 w-full rounded-xl border px-4 text-start transition-colors outline-none focus-visible:ring-2',
          error ? 'border-destructive bg-destructive-soft/40' : 'border-border',
        )}
        data-umami-event={umami}
      />
      {error ? (
        <p
          id={`${id}-error`}
          className="text-destructive mt-1.5 flex items-center gap-1 text-xs"
        >
          <AlertCircle size={12} className="shrink-0" aria-hidden="true" />{' '}
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground mt-1.5 text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
