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
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { delData, patchData, postData } from '@/lib/api-client';
import {
  normalizePostalCode,
  validateAddress,
  type AddressInput,
} from '@/lib/account/address';
import { requestFieldErrors } from '@/lib/checkout/field-errors';
import { API_PATHS, apiMeAddressPath } from '@/lib/constant/paths';
import type { AddressResponse } from '@/lib/hono/routes/me-addresses';
import { toPersianDigits } from '@/lib/format';
import { STALE_PROVINCE_MESSAGE } from '@/lib/shipping/province-input';
import {
  controlClass,
  fieldAria,
  FieldShell,
  TextField,
} from '@/components/ui/field';
import {
  DeleteConfirm,
  EmptyState,
  FormActions,
  FormAlert,
  GENERIC_ERROR,
  useFormState,
} from './account-ui';

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
  postalCode: normalizePostalCode(form.postalCode),
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
            className="bg-brand hover:bg-brand-hover text-brand-foreground flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors"
            data-umami-event="account-addresses-add"
          >
            <Plus size={14} aria-hidden="true" /> آدرس جدید
          </button>
        )}
      </div>

      {addresses.length === 0 && !editing && (
        <EmptyState
          icon={
            <MapPin
              size={40}
              className="text-muted-foreground mx-auto mb-3"
              aria-hidden="true"
            />
          }
          title="هنوز آدرسی ذخیره نکرده‌ای"
          description="یک آدرس ذخیره کن تا در تکمیل خرید سریع‌تر باشی."
        />
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
                question="این آدرس حذف شود؟"
                umami="account-addresses-delete-confirm"
                className="mt-4"
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
  const {
    form,
    set,
    fieldErrors,
    setFieldErrors,
    topError,
    setTopError,
    busy,
    setBusy,
  } = useFormState(initial);

  // An address saved against a province the admin has since deactivated: its id
  // is not among the (active) options, so React would display the first enabled
  // one — which re-picking fires no change for. The select gets '' instead,
  // showing its placeholder, while state keeps the stale id. Derived at render,
  // and `save` refuses it — the API's 422 is the backstop, not the experience.
  const staleProvince =
    form.provinceId !== '' &&
    !provinces.some((p) => String(p.provinceId) === form.provinceId);
  const provinceError =
    fieldErrors.provinceId ??
    (staleProvince ? STALE_PROVINCE_MESSAGE : undefined);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setTopError(undefined);

    // Client-side gate; the server stays authoritative.
    const errors = validateAddress(form, staleProvince);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setBusy(false);
      return;
    }

    try {
      onSaved(await submit(toBody(form)));
    } catch (error) {
      setBusy(false);
      const { fields, message } = requestFieldErrors(error, GENERIC_ERROR);
      setFieldErrors(fields);
      setTopError(message);
    }
  };

  return (
    <div className="bg-card border-accent/30 rounded-2xl border-2 p-6">
      <h3 className="mb-4 font-bold">
        {initial.recipientName ? 'ویرایش آدرس' : 'افزودن آدرس جدید'}
      </h3>

      <FormAlert message={topError} />

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
        <FieldShell id="addr-province" label="استان" error={provinceError}>
          <select
            id="addr-province"
            value={staleProvince ? '' : form.provinceId}
            onChange={(event) => set('provinceId', event.target.value)}
            {...fieldAria('addr-province', provinceError)}
            className={controlClass(Boolean(provinceError))}
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
            {...fieldAria('addr-line', fieldErrors.addressLine)}
            className={controlClass(Boolean(fieldErrors.addressLine))}
            data-umami-event="account-addresses-line"
          />
        </FieldShell>
      </div>

      <FormActions
        busy={busy}
        onSave={save}
        onCancel={onCancel}
        saveUmami="account-addresses-save"
        cancelUmami="account-addresses-cancel"
      />
    </div>
  );
}
