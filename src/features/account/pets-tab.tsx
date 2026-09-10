'use client';

// The «حیوانات من» tab: the customer's pet profiles, with add / edit / delete.
//
// The list is SEEDED from the server page's props and then owns its own state —
// each mutation updates the array from the API response (create/update return the
// pet, delete echoes its id). No `router.refresh()` and no prop-derived state, so
// there is no server/prop-vs-intention window to get wrong. Every write is the
// owner-scoped `/api/me/pets` route; the session is the only authority on whose
// pets these are.
import { useState } from 'react';
import { AlertCircle, Camera, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  delData,
  patchData,
  postData,
  ApiRequestError,
} from '@/lib/api-client';
import { PET_GENDERS, isHttpsUrl, type PetInput } from '@/lib/account/pet';
import { PET_TYPES } from '@/lib/catalog/product-query';
import { parseFieldErrors } from '@/lib/checkout/field-errors';
import { API_PATHS, apiMePetPath } from '@/lib/constant/paths';
import type { PetResponse } from '@/lib/hono/routes/me-pets';
import { toPersianDigits } from '@/lib/format';
import { cn } from '@/lib/utils';
import { FieldShell, TextField } from '@/features/account/account-fields';

const GENERIC_ERROR = 'انجام نشد. لطفاً دوباره تلاش کن.';

type FormValues = {
  name: string;
  type: PetResponse['type'];
  gender: PetResponse['gender'];
  neutered: boolean;
  breed: string;
  age: string;
  weight: string;
  photoUrl: string;
};

const blank = (): FormValues => ({
  name: '',
  type: PET_TYPES.CAT,
  gender: PET_GENDERS.FEMALE,
  neutered: false,
  breed: '',
  age: '',
  weight: '',
  photoUrl: '',
});

const fromPet = (pet: PetResponse): FormValues => ({
  name: pet.name,
  type: pet.type,
  gender: pet.gender,
  neutered: pet.neutered,
  breed: pet.breed ?? '',
  age: pet.age ?? '',
  weight: pet.weight ?? '',
  photoUrl: pet.photoUrl ?? '',
});

const toBody = (form: FormValues): PetInput => ({
  name: form.name.trim(),
  type: form.type,
  gender: form.gender,
  neutered: form.neutered,
  breed: form.breed.trim() || undefined,
  age: form.age.trim() || undefined,
  weight: form.weight.trim() || undefined,
  photoUrl: form.photoUrl.trim() || undefined,
});

export function PetsTab({ initialPets }: { initialPets: PetResponse[] }) {
  const [pets, setPets] = useState(initialPets);
  // null = form closed; { id: null } = adding; { id } = editing that pet.
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const openNew = () => setEditing({ id: null });

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-bold">حیوانات من</h2>
        {!editing && (
          <button
            type="button"
            onClick={openNew}
            className="bg-accent-strong hover:bg-accent-hover flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white transition-colors"
            data-umami-event="account-pets-add"
          >
            <Plus size={14} aria-hidden="true" /> افزودن
          </button>
        )}
      </div>

      {pets.length === 0 && !editing && (
        <div className="bg-secondary/40 rounded-2xl py-16 text-center">
          <p className="mb-1 text-2xl" aria-hidden="true">
            🐾
          </p>
          <p className="mb-1 font-semibold">هنوز حیوانی اضافه نکرده‌ای</p>
          <p className="text-muted-foreground text-sm">
            پروفایل حیوان خانگی‌ات را اینجا بساز.
          </p>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {pets.map((pet) => (
          <div
            key={pet.id}
            className="bg-card border-border rounded-2xl border p-5"
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="bg-secondary flex size-12 items-center justify-center overflow-hidden rounded-full text-2xl">
                  {isHttpsUrl(pet.photoUrl) ? (
                    <img
                      src={pet.photoUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="size-full object-cover"
                    />
                  ) : (
                    <span aria-hidden="true">
                      {pet.type === PET_TYPES.CAT ? '🐱' : '🐶'}
                    </span>
                  )}
                </div>
                <div>
                  <p className="font-bold">{pet.name}</p>
                  {pet.breed && (
                    <p className="text-muted-foreground text-sm">{pet.breed}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`ویرایش ${pet.name}`}
                  onClick={() => {
                    setPendingDelete(null);
                    setEditing({ id: pet.id });
                  }}
                  className="hover:bg-secondary flex size-10 items-center justify-center rounded-lg transition-colors"
                  data-umami-event="account-pets-edit"
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`حذف ${pet.name}`}
                  onClick={() => setPendingDelete(pet.id)}
                  className="hover:bg-destructive-soft text-destructive flex size-10 items-center justify-center rounded-lg transition-colors"
                  data-umami-event="account-pets-delete"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </div>

            {pendingDelete === pet.id ? (
              <DeleteConfirm
                onCancel={() => setPendingDelete(null)}
                onConfirm={async () => {
                  await delData(apiMePetPath(pet.id));
                  setEditing((current) =>
                    current?.id === pet.id ? null : current,
                  );
                  setPets((prev) => prev.filter((p) => p.id !== pet.id));
                  setPendingDelete(null);
                }}
              />
            ) : (
              <div className="grid grid-cols-2 gap-2 text-sm">
                {(
                  [
                    ['سن', pet.age ? toPersianDigits(pet.age) : '—'],
                    ['وزن', pet.weight ? toPersianDigits(pet.weight) : '—'],
                    ['جنس', pet.gender === PET_GENDERS.FEMALE ? 'ماده' : 'نر'],
                    ['عقیم‌شده', pet.neutered ? 'بله' : 'خیر'],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="bg-secondary/50 rounded-lg p-2.5">
                    <p className="text-muted-foreground text-xs">{label}</p>
                    <p className="font-medium">{value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <PetForm
          key={editing.id ?? 'new'}
          initial={
            editing.id
              ? fromPet(pets.find((p) => p.id === editing.id)!)
              : blank()
          }
          onCancel={() => setEditing(null)}
          onSaved={(pet) => {
            setPets((prev) =>
              editing.id
                ? prev.map((p) => (p.id === pet.id ? pet : p))
                : [...prev, pet],
            );
            setEditing(null);
          }}
          submit={async (body) =>
            editing.id
              ? patchData<PetResponse>(apiMePetPath(editing.id), body)
              : postData<PetResponse>(API_PATHS.ME_PETS, body)
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
    <div className="bg-destructive-soft/40 rounded-lg p-3">
      <p className="mb-2 text-sm font-medium">این حیوان حذف شود؟</p>
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
          data-umami-event="account-pets-delete-confirm"
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

function PetForm({
  initial,
  onCancel,
  onSaved,
  submit,
}: {
  initial: FormValues;
  onCancel: () => void;
  onSaved: (pet: PetResponse) => void;
  submit: (body: PetInput) => Promise<PetResponse>;
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
    // Client-side gate for the one required field; the server stays authoritative.
    if (!form.name.trim()) {
      setFieldErrors({ name: 'نام حیوان را وارد کن.' });
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
        {initial.name ? 'ویرایش حیوان' : 'افزودن حیوان جدید'}
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

      <div className="mb-5 flex items-center gap-4">
        <div className="bg-secondary flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full text-2xl">
          {isHttpsUrl(form.photoUrl) ? (
            <img
              src={form.photoUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="size-full object-cover"
            />
          ) : (
            <span aria-hidden="true">
              {form.type === PET_TYPES.CAT ? '🐱' : '🐶'}
            </span>
          )}
        </div>
        <div className="flex-1">
          <TextField
            id="pet-photo-url"
            label="نشانی عکس (اختیاری)"
            value={form.photoUrl}
            onChange={(v) => set('photoUrl', v)}
            error={fieldErrors.photoUrl}
            hint="نشانی یک تصویر با https"
            dir="ltr"
            inputMode="url"
            umami="account-pets-photo-url"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          id="pet-name"
          label="نام"
          value={form.name}
          onChange={(v) => set('name', v)}
          error={fieldErrors.name}
          umami="account-pets-name"
        />
        <TextField
          id="pet-breed"
          label="نژاد"
          value={form.breed}
          onChange={(v) => set('breed', v)}
          error={fieldErrors.breed}
          umami="account-pets-breed"
        />
        <TextField
          id="pet-age"
          label="سن"
          value={form.age}
          onChange={(v) => set('age', v)}
          error={fieldErrors.age}
          umami="account-pets-age"
        />
        <TextField
          id="pet-weight"
          label="وزن"
          value={form.weight}
          onChange={(v) => set('weight', v)}
          error={fieldErrors.weight}
          umami="account-pets-weight"
        />

        <FieldShell id="pet-type" label="نوع">
          <div className="flex gap-2">
            {(
              [
                { v: PET_TYPES.CAT, l: '🐱 گربه' },
                { v: PET_TYPES.DOG, l: '🐶 سگ' },
              ] as const
            ).map((option) => (
              <button
                key={option.v}
                type="button"
                aria-pressed={form.type === option.v}
                onClick={() => set('type', option.v)}
                className={cn(
                  'flex-1 rounded-xl border-2 py-2.5 text-sm font-medium transition-colors',
                  form.type === option.v
                    ? 'border-accent-strong bg-accent/10 text-accent-strong'
                    : 'border-border',
                )}
                data-umami-event="account-pets-type"
              >
                {option.l}
              </button>
            ))}
          </div>
        </FieldShell>

        <FieldShell id="pet-gender" label="جنس">
          <div className="flex gap-2">
            {(
              [
                { v: PET_GENDERS.FEMALE, l: 'ماده' },
                { v: PET_GENDERS.MALE, l: 'نر' },
              ] as const
            ).map((option) => (
              <button
                key={option.v}
                type="button"
                aria-pressed={form.gender === option.v}
                onClick={() => set('gender', option.v)}
                className={cn(
                  'flex-1 rounded-xl border-2 py-2.5 text-sm font-medium transition-colors',
                  form.gender === option.v
                    ? 'border-accent-strong bg-accent/10 text-accent-strong'
                    : 'border-border',
                )}
                data-umami-event="account-pets-gender"
              >
                {option.l}
              </button>
            ))}
          </div>
        </FieldShell>
      </div>

      <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.neutered}
          onChange={(event) => set('neutered', event.target.checked)}
          className="accent-accent-strong size-4"
          data-umami-event="account-pets-neutered"
        />
        عقیم‌شده
      </label>

      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="bg-accent-strong hover:bg-accent-hover flex-1 rounded-xl py-3 font-bold text-white transition-colors disabled:opacity-60"
          data-umami-event="account-pets-save"
        >
          <span className="flex items-center justify-center gap-2">
            <Camera size={16} aria-hidden="true" />
            {busy ? 'در حال ذخیره…' : 'ذخیره'}
          </span>
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="border-border hover:bg-secondary rounded-xl border-2 px-5 py-3 font-medium transition-colors disabled:opacity-60"
          data-umami-event="account-pets-cancel"
        >
          انصراف
        </button>
      </div>
    </div>
  );
}
