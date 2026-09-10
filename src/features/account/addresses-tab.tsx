'use client';

// The «آدرس‌ها» tab: the customer's saved address book, with add / edit / delete.
// AccountView owns the saved list so it survives this tab unmounting; writes use
// the same owner-scoped API shape as the pets tab.
//
// A saved address is a checkout delivery address plus a label, so the fields (and
// their validation) match the checkout address step exactly — the same shared
// contract drives both. The postal code is normalized to ASCII on save, as
// checkout does, so a code typed on a Persian keyboard stores canonically.
import { useState, type Dispatch, type SetStateAction } from 'react';
import { AlertCircle, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  delData,
  patchData,
  postData,
  ApiRequestError,
} from '@/lib/api-client';
import type { AddressInput } from '@/lib/account/address';
import { parseFieldErrors } from '@/lib/checkout/field-errors';
import { API_PATHS, apiMeAddressPath } from '@/lib/constant/paths';
import type { AddressResponse } from '@/lib/hono/routes/me-addresses';
import { toAsciiDigits, toPersianDigits } from '@/lib/format';
import {
  controlClass,
  FieldShell,
  TextField,
} from '@/features/account/account-fields';

const GENERIC_ERROR = 'انجام نشد. لطفاً دوباره تلاش کن.';

/** The province options the select renders — the same rows checkout uses. */
export type ProvinceOption = { provinceId: number; name: string };

type FormValues = {
  title: string;
  recipientName: string;
  recipientPhone: string;
  provinceId: string;
  city: string;
  postalCode: string;
  addressLine: string;
};

const blank = (): FormValues => ({
  title: '',
  recipientName: '',
  recipientPhone: '',
  provinceId: '',
  city: '',
  postalCode: '',
  addressLine: '',
});

const fromAddress = (a: AddressResponse): FormValues => ({
  title: a.title ?? '',
  recipientName: a.recipientName,
  recipientPhone: a.recipientPhone,
  provinceId: String(a.provinceId),
  city: a.city,
  postalCode: a.postalCode,
  addressLine: a.addressLine,
});

const toBody = (form: FormValues): AddressInput => ({
  title: form.title.trim() || undefined,
  recipientName: form.recipientName.trim(),
  recipientPhone: form.recipientPhone.trim(),
  provinceId: Number(form.provinceId),
  city: form.city.trim(),
  postalCode: toAsciiDigits(form.postalCode).replace(/\D/g, ''),
  addressLine: form.addressLine.trim(),
});

export function AddressesTab({
  addresses,
  onAddressesChange,
  provinces,
}: {
  addresses: AddressResponse[];
  onAddressesChange: Dispatch<SetStateAction<AddressResponse[]>>;
  provinces: ProvinceOption[];
}) {
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-bold">آدرس‌های من</h2>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing({ id: null })}
            className="bg-accent-strong hover:bg-accent-hover flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-colors"
            data-umami-event="account-addresses-add"
          >
            <Plus size={14} aria-hidden="true" /> آدرس جدید
          </button>
        )}
      </div>

      {addresses.length === 0 && !editing && (
        <div className="bg-secondary/40 rounded-2xl py-16 text-center">
          <MapPin
            size={40}
            className="text-muted-foreground mx-auto mb-3"
            aria-hidden="true"
          />
          <p className="mb-1 font-semibold">هنوز آدرسی ذخیره نکرده‌ای</p>
          <p className="text-muted-foreground text-sm">
            یک آدرس ذخیره کن تا در تکمیل خرید سریع‌تر باشی.
          </p>
        </div>
      )}

      <div className="mb-6 space-y-3">
        {addresses.map((address) => (
          <div
            key={address.id}
            className="bg-card border-border rounded-xl border p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="mb-1 font-semibold">
                  {address.title ? `${address.title} — ` : ''}
                  {address.provinceName}
                </p>
                <p className="text-muted-foreground text-sm">
                  {address.recipientName} · {address.city}
                </p>
                <p className="text-muted-foreground text-sm">
                  {address.addressLine}
                </p>
                <p className="text-muted-foreground text-sm">
                  کد پستی: {toPersianDigits(address.postalCode)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`ویرایش آدرس ${address.title ?? address.provinceName}`}
                  onClick={() => {
                    setPendingDelete(null);
                    setEditing({ id: address.id });
                  }}
                  className="hover:bg-secondary flex size-10 items-center justify-center rounded-lg transition-colors"
                  data-umami-event="account-addresses-edit"
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`حذف آدرس ${address.title ?? address.provinceName}`}
                  onClick={() => setPendingDelete(address.id)}
                  className="hover:bg-destructive-soft text-destructive flex size-10 items-center justify-center rounded-lg transition-colors"
                  data-umami-event="account-addresses-delete"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </div>

            {pendingDelete === address.id && (
              <DeleteConfirm
                onCancel={() => setPendingDelete(null)}
                onConfirm={async () => {
                  await delData(apiMeAddressPath(address.id));
                  setEditing((current) =>
                    current?.id === address.id ? null : current,
                  );
                  onAddressesChange((prev) =>
                    prev.filter((a) => a.id !== address.id),
                  );
                  setPendingDelete(null);
                }}
              />
            )}
          </div>
        ))}
      </div>

      {editing && (
        <AddressForm
          key={editing.id ?? 'new'}
          provinces={provinces}
          initial={
            editing.id
              ? fromAddress(addresses.find((a) => a.id === editing.id)!)
              : blank()
          }
          onCancel={() => setEditing(null)}
          onSaved={(address) => {
            onAddressesChange((prev) =>
              editing.id
                ? prev.map((a) => (a.id === address.id ? address : a))
                : [...prev, address],
            );
            setEditing(null);
          }}
          submit={async (body) =>
            editing.id
              ? patchData<AddressResponse>(apiMeAddressPath(editing.id), body)
              : postData<AddressResponse>(API_PATHS.ME_ADDRESSES, body)
          }
        />
      )}
    </div>
  );
}

function DeleteConfirm({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  return (
    <div className="bg-destructive-soft/40 mt-4 rounded-lg p-3">
      <p className="mb-2 text-sm font-medium">این آدرس حذف شود؟</p>
      {error && (
        <p role="alert" className="text-destructive mb-2 text-xs">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(undefined);
            try {
              await onConfirm();
            } catch (caught) {
              setError(
                caught instanceof Error ? caught.message : GENERIC_ERROR,
              );
              setBusy(false);
            }
          }}
          className="bg-destructive rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-60"
          data-umami-event="account-addresses-delete-confirm"
        >
          {busy ? 'در حال حذف…' : 'حذف'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="border-border hover:bg-secondary rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
        >
          انصراف
        </button>
      </div>
    </div>
  );
}

function AddressForm({
  provinces,
  initial,
  onCancel,
  onSaved,
  submit,
}: {
  provinces: ProvinceOption[];
  initial: FormValues;
  onCancel: () => void;
  onSaved: (address: AddressResponse) => void;
  submit: (body: AddressInput) => Promise<AddressResponse>;
}) {
  const [form, setForm] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key as string];
      return next;
    });
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setTopError(undefined);

    // Client-side gate; the server stays authoritative.
    const errors: Record<string, string> = {};
    if (!form.recipientName.trim())
      errors.recipientName = 'نام گیرنده را وارد کن.';
    if (!form.recipientPhone.trim())
      errors.recipientPhone = 'شماره تماس گیرنده را وارد کن.';
    if (!form.provinceId) errors.provinceId = 'استان را انتخاب کن.';
    if (!form.city.trim()) errors.city = 'شهر را وارد کن.';
    if (form.addressLine.trim().length < 10)
      errors.addressLine = 'آدرس کامل را وارد کن (حداقل ۱۰ حرف).';
    if (toAsciiDigits(form.postalCode).replace(/\D/g, '').length !== 10)
      errors.postalCode = 'کد پستی باید ۱۰ رقم باشد.';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setBusy(false);
      return;
    }

    try {
      onSaved(await submit(toBody(form)));
    } catch (error) {
      setBusy(false);
      if (
        error instanceof ApiRequestError &&
        (error.status === 400 || error.status === 422)
      ) {
        const { fields, unmapped } = parseFieldErrors(error.errors);
        setFieldErrors(fields);
        setTopError(
          unmapped.length > 0
            ? unmapped.join(' ')
            : Object.keys(fields).length === 0
              ? error.message
              : undefined,
        );
        return;
      }
      setTopError(error instanceof Error ? error.message : GENERIC_ERROR);
    }
  };

  return (
    <div className="bg-card border-accent/30 rounded-2xl border-2 p-6">
      <h3 className="mb-4 font-bold">
        {initial.recipientName ? 'ویرایش آدرس' : 'افزودن آدرس جدید'}
      </h3>

      {topError && (
        <p
          role="alert"
          className="text-destructive border-destructive/30 bg-destructive-soft/40 mb-4 flex items-center gap-2 rounded-xl border p-3 text-sm"
        >
          <AlertCircle size={16} className="shrink-0" aria-hidden="true" />
          {topError}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          id="addr-title"
          label="عنوان (اختیاری)"
          value={form.title}
          onChange={(v) => set('title', v)}
          error={fieldErrors.title}
          hint="مثلاً خانه یا محل کار"
          umami="account-addresses-title"
        />
        <FieldShell
          id="addr-province"
          label="استان"
          error={fieldErrors.provinceId}
        >
          <select
            id="addr-province"
            value={form.provinceId}
            onChange={(event) => set('provinceId', event.target.value)}
            aria-invalid={Boolean(fieldErrors.provinceId)}
            aria-describedby={
              fieldErrors.provinceId ? 'addr-province-error' : undefined
            }
            className={controlClass(Boolean(fieldErrors.provinceId))}
            data-umami-event="account-addresses-province"
          >
            <option value="" disabled>
              استان را انتخاب کن
            </option>
            {provinces.map((province) => (
              <option key={province.provinceId} value={province.provinceId}>
                {province.name}
              </option>
            ))}
          </select>
        </FieldShell>
        <TextField
          id="addr-recipient-name"
          label="نام و نام خانوادگی گیرنده"
          value={form.recipientName}
          onChange={(v) => set('recipientName', v)}
          error={fieldErrors.recipientName}
          umami="account-addresses-recipient-name"
        />
        <TextField
          id="addr-recipient-phone"
          label="شماره تماس گیرنده"
          value={form.recipientPhone}
          onChange={(v) => set('recipientPhone', v)}
          error={fieldErrors.recipientPhone}
          dir="ltr"
          inputMode="tel"
          umami="account-addresses-recipient-phone"
        />
        <TextField
          id="addr-city"
          label="شهر"
          value={form.city}
          onChange={(v) => set('city', v)}
          error={fieldErrors.city}
          umami="account-addresses-city"
        />
        <TextField
          id="addr-postal"
          label="کد پستی"
          value={form.postalCode}
          onChange={(v) => set('postalCode', v)}
          error={fieldErrors.postalCode}
          hint="۱۰ رقم، بدون خط تیره"
          dir="ltr"
          inputMode="numeric"
          umami="account-addresses-postal"
        />
      </div>

      <div className="mt-4">
        <FieldShell
          id="addr-line"
          label="آدرس کامل"
          error={fieldErrors.addressLine}
        >
          <textarea
            id="addr-line"
            rows={3}
            value={form.addressLine}
            onChange={(event) => set('addressLine', event.target.value)}
            placeholder="خیابان، کوچه، پلاک، واحد"
            aria-invalid={Boolean(fieldErrors.addressLine)}
            aria-describedby={
              fieldErrors.addressLine ? 'addr-line-error' : undefined
            }
            className={controlClass(Boolean(fieldErrors.addressLine))}
            data-umami-event="account-addresses-line"
          />
        </FieldShell>
      </div>

      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="bg-accent-strong hover:bg-accent-hover flex-1 rounded-xl py-3 font-bold text-white transition-colors disabled:opacity-60"
          data-umami-event="account-addresses-save"
        >
          {busy ? 'در حال ذخیره…' : 'ذخیره'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="border-border hover:bg-secondary rounded-xl border-2 px-5 py-3 font-medium transition-colors disabled:opacity-60"
          data-umami-event="account-addresses-cancel"
        >
          انصراف
        </button>
      </div>
    </div>
  );
}
