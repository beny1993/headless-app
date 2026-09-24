'use client';

import { useId, useState } from 'react';
import { Loader2, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { patchData, postData } from '@/lib/api-client';
import {
  reasonFrom,
  requestFieldErrors,
  zodFieldErrors,
} from '@/lib/checkout/field-errors';
import { API_PATHS, apiAdminDiscountPath } from '@/lib/constant/paths';
import {
  DISCOUNT_TYPES,
  type DiscountType,
  discountCodeInputSchema,
} from '@/lib/discount/discount-code';
import {
  formatJalali,
  formatToman,
  parseDigits,
  toPersianDigits,
} from '@/lib/format';
import type { DiscountCodeView } from '@/lib/hono/routes/admin-discounts';
import { cn } from '@/lib/utils';
import { AdminTable } from '@/features/admin-panel/shared/admin-table';
import { CreateCard } from '@/features/admin-panel/shared/create-card';
import { Pill } from '@/features/admin-panel/shared/pill';
import {
  controlClass,
  fieldAria,
  FieldShell,
  TextField,
} from '@/components/ui/field';

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

  const submit = async () => {
    if (busy) return;
    setErrors({});
    setJustCreated(null);

    // Build the body with the shared contract's shape; client-validate for inline
    // errors, then let the server re-validate authoritatively.
    const candidate = {
      code: code.trim(),
      type,
      value: parseDigits(value),
      minOrderAmount: parseDigits(minOrderAmount) ?? 0,
      usageLimit: parseDigits(usageLimit) ?? null,
      expiresAt: expiresAt.trim() === '' ? null : expiresAt.trim(),
      isActive: true,
    };

    const parsed = discountCodeInputSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
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
      const { fields, message } = requestFieldErrors(
        error,
        'ساخت کد تخفیف ناموفق بود. دوباره تلاش کن.',
      );
      setErrors(fields);
      if (message) toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CreateCard
      title="ساخت کد تخفیف"
      icon={<Tag size={18} className="text-accent-strong" aria-hidden="true" />}
      onSubmit={submit}
      busy={busy}
      done={justCreated && <>کد «{justCreated}» ساخته شد</>}
      submitLabel="ساخت کد"
      umami="admin-panel-discount-create"
    >
      <TextField
        id={`${fieldId}-code`}
        label="کد"
        value={code}
        onChange={setCode}
        error={errors.code}
        dir="ltr"
        placeholder="مثل NOWRUZ1405"
        umami="admin-panel-discount-code"
      />

      <FieldShell id={`${fieldId}-type`} label="نوع تخفیف">
        <select
          id={`${fieldId}-type`}
          value={type}
          onChange={(event) => setType(event.target.value as DiscountType)}
          className={controlClass(false)}
          data-umami-event="admin-panel-discount-type"
        >
          <option value={DISCOUNT_TYPES.PERCENT}>درصدی</option>
          <option value={DISCOUNT_TYPES.FIXED}>مبلغی (تومان)</option>
        </select>
      </FieldShell>

      <TextField
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

      <TextField
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

      <TextField
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

      <FieldShell
        id={`${fieldId}-expires`}
        label="تاریخ انقضا"
        error={errors.expiresAt}
        hint="خالی یعنی بدون انقضا"
      >
        <input
          id={`${fieldId}-expires`}
          type="date"
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)}
          dir="ltr"
          {...fieldAria(
            `${fieldId}-expires`,
            errors.expiresAt,
            'خالی یعنی بدون انقضا',
          )}
          className={controlClass(Boolean(errors.expiresAt))}
          data-umami-event="admin-panel-discount-expires"
        />
      </FieldShell>
    </CreateCard>
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
    <AdminTable
      headings={['کد', 'تخفیف', 'حداقل سفارش', 'استفاده', 'انقضا', 'وضعیت']}
      actions="تغییر وضعیت"
    >
      {codes.map((code) => (
        <CodeRow key={code.id} code={code} onToggled={onToggled} />
      ))}
    </AdminTable>
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
      toast.error(reasonFrom(requestError) ?? 'تغییر وضعیت ناموفق بود.');
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
        <Pill tone={code.isActive ? 'success' : 'muted'}>
          {code.isActive ? 'فعال' : 'غیرفعال'}
        </Pill>
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
