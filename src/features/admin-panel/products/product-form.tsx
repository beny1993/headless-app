'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { AlertCircle, ChevronRight, Loader2 } from 'lucide-react';
import { z } from 'zod';
import { ApiRequestError, postData, putData } from '@/lib/api-client';
import {
  productInputSchema,
  productUpdateInputSchema,
} from '@/lib/catalog/product-input';
import { PET_TYPES, type PetType } from '@/lib/catalog/product-query';
import { parseFieldErrors } from '@/lib/checkout/field-errors';
import {
  API_PATHS,
  apiAdminProductImagesPath,
  apiAdminProductPath,
  PROTECTED_PATHS,
} from '@/lib/constant/paths';
import { formatToman, toAsciiDigits } from '@/lib/format';
import { IMAGE_FIELD_NAME } from '@/lib/storage/image-upload';
import { imageSrc } from '@/lib/storage/image-url';
import {
  ImagePicker,
  validateImageFile,
} from '@/features/admin-panel/shared/image-picker';

// The form imports nothing from the route module: that would pull `pg` into the
// browser bundle. It only reads the saved product's id back, so this narrow
// shape is all it needs.
type SavedProduct = { id: string };

/** The product the edit form starts from — the fields it round-trips. */
export type ProductFormInitial = {
  id: string;
  title: string;
  slug: string;
  sku: string;
  brand: string | null;
  description: string | null;
  benefit: string | null;
  price: number;
  oldPrice: number | null;
  stock: number;
  categoryId: string;
  petType: PetType;
  isActive: boolean;
  /** The current image's storage key, if any, so the edit form can preview it. */
  imageKey: string | null;
};

export type CategoryOption = { id: string; title: string };

const GENERIC_ERROR = 'خطای غیرمنتظره رخ داد. دوباره تلاش کن.';

/** Numeric-input string → number: Persian digits folded, empty/blank → NaN so
 *  the schema rejects it with the field's own message. */
const numeric = (value: string): number => {
  const ascii = toAsciiDigits(value).trim();
  return ascii === '' ? Number.NaN : Number(ascii);
};

/** Map a ZodError to `{ field: message }`, first issue per field winning. */
const zodFieldErrors = (error: z.ZodError): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '');
    if (key && !(key in fields)) fields[key] = issue.message;
  }
  return fields;
};

/** Upload the chosen image to the just-saved product. Multipart, so a raw fetch
 *  rather than the JSON api-client; same-origin, so the session cookie rides. */
async function uploadImage(productId: string, file: File): Promise<void> {
  const form = new FormData();
  form.set(IMAGE_FIELD_NAME, file);
  const response = await fetch(apiAdminProductImagesPath(productId), {
    method: 'POST',
    body: form,
  });
  const body = (await response.json().catch(() => null)) as {
    status?: string;
    message?: string;
  } | null;
  if (!response.ok || body?.status !== 'success') {
    throw new Error(body?.message ?? 'بارگذاری تصویر ناموفق بود.');
  }
}

export function ProductForm({
  categories,
  product,
}: {
  categories: CategoryOption[];
  product?: ProductFormInitial;
}) {
  const router = useRouter();
  const isEdit = Boolean(product);
  const formId = useId();

  const [form, setForm] = useState({
    title: product?.title ?? '',
    slug: product?.slug ?? '',
    sku: product?.sku ?? '',
    brand: product?.brand ?? '',
    description: product?.description ?? '',
    benefit: product?.benefit ?? '',
    price: product ? String(product.price) : '',
    oldPrice: product?.oldPrice != null ? String(product.oldPrice) : '',
    stock: product ? String(product.stock) : '',
    categoryId: product?.categoryId ?? '',
    petType: product?.petType ?? PET_TYPES.CAT,
    isActive: product?.isActive ?? true,
  });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(
    product?.imageKey ? imageSrc(product.imageKey) : null,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const update = (key: keyof typeof form, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: '' }));
  };

  const onPickFile = (chosen: File | undefined) => {
    if (!chosen) return;
    const invalid = validateImageFile(chosen);
    if (invalid) {
      setFieldErrors((current) => ({ ...current, image: invalid }));
      return;
    }
    setFieldErrors((current) => ({ ...current, image: '' }));
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
  };

  const buildBody = () => ({
    title: form.title,
    slug: form.slug,
    sku: form.sku,
    brand: form.brand,
    description: form.description,
    benefit: form.benefit,
    price: numeric(form.price),
    oldPrice: form.oldPrice.trim() === '' ? null : numeric(form.oldPrice),
    stock: numeric(form.stock),
    categoryId: form.categoryId,
    petType: form.petType,
    isActive: form.isActive,
  });

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTopError(undefined);

    const parsed = product
      ? productUpdateInputSchema.safeParse({
          ...buildBody(),
          expectedStock: product.stock,
        })
      : productInputSchema.safeParse(buildBody());
    if (!parsed.success) {
      setFieldErrors(zodFieldErrors(parsed.error));
      return;
    }

    setBusy(true);
    try {
      const saved = isEdit
        ? await putData<SavedProduct>(
            apiAdminProductPath(product!.id),
            parsed.data,
          )
        : await postData<SavedProduct>(API_PATHS.ADMIN_PRODUCTS, parsed.data);

      if (file) {
        // The product is already saved; a failed image attach must not look like
        // the save failed (and must not re-POST and duplicate the slug). Land on
        // the list and say the image did not attach — it can be retried there.
        try {
          await uploadImage(saved.id, file);
        } catch {
          router.push(PROTECTED_PATHS.PRODUCTS);
          router.refresh();
          window.alert(
            'محصول ذخیره شد اما بارگذاری تصویر ناموفق بود. از فهرست محصولات دوباره تلاش کن.',
          );
          return;
        }
      }

      router.push(PROTECTED_PATHS.PRODUCTS);
      router.refresh();
    } catch (error) {
      setBusy(false);
      if (
        error instanceof ApiRequestError &&
        (error.status === 400 || error.status === 409 || error.status === 422)
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

  const money = (value: string): string | null => {
    const n = numeric(value);
    return Number.isSafeInteger(n) && n > 0 ? formatToman(n) : null;
  };

  const fid = (name: string) => `${formId}-${name}`;

  return (
    <div className="max-w-3xl">
      <button
        type="button"
        onClick={() => router.push(PROTECTED_PATHS.PRODUCTS)}
        className="text-muted-foreground hover:text-foreground mb-5 flex items-center gap-2 text-sm"
      >
        <ChevronRight size={14} aria-hidden="true" /> بازگشت به فهرست محصولات
      </button>
      <h1 className="mb-6 text-2xl font-black">
        {isEdit ? 'ویرایش محصول' : 'محصول جدید'}
      </h1>

      {topError && (
        <p
          role="alert"
          className="text-destructive border-destructive/30 bg-destructive-soft/40 mb-4 flex items-center gap-2 rounded-xl border p-3 text-sm"
        >
          <AlertCircle size={16} className="shrink-0" aria-hidden="true" />
          {topError}
        </p>
      )}

      <form
        onSubmit={onSubmit}
        noValidate
        className="border-border space-y-5 rounded-2xl border bg-white p-6"
      >
        <ImagePicker
          id={fid('image')}
          label="تصویر محصول"
          preview={preview}
          error={fieldErrors.image}
          buttonLabel={isEdit || preview ? 'تغییر تصویر' : 'انتخاب تصویر'}
          onPick={onPickFile}
        />

        <Field id={fid('title')} label="عنوان محصول" error={fieldErrors.title}>
          <input
            id={fid('title')}
            value={form.title}
            onChange={(e) => update('title', e.target.value)}
            className={inputClass(fieldErrors.title)}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            id={fid('slug')}
            label="نشانی یکتا (slug)"
            hint="در آدرس صفحه محصول استفاده می‌شود"
            error={fieldErrors.slug}
          >
            <input
              id={fid('slug')}
              dir="ltr"
              value={form.slug}
              onChange={(e) => update('slug', e.target.value)}
              placeholder="royal-canin-adult-cat"
              className={`${inputClass(fieldErrors.slug)} text-start`}
            />
          </Field>
          <Field
            id={fid('sku')}
            label="کد کالا (SKU)"
            hint="روی اقلام سفارش ثبت (snapshot) می‌شود"
            error={fieldErrors.sku}
          >
            <input
              id={fid('sku')}
              dir="ltr"
              value={form.sku}
              onChange={(e) => update('sku', e.target.value)}
              className={`${inputClass(fieldErrors.sku)} text-start`}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id={fid('brand')} label="برند" error={fieldErrors.brand}>
            <input
              id={fid('brand')}
              value={form.brand}
              onChange={(e) => update('brand', e.target.value)}
              className={inputClass(fieldErrors.brand)}
            />
          </Field>
          <Field
            id={fid('categoryId')}
            label="دسته‌بندی"
            error={fieldErrors.categoryId}
          >
            <select
              id={fid('categoryId')}
              value={form.categoryId}
              onChange={(e) => update('categoryId', e.target.value)}
              className={inputClass(fieldErrors.categoryId)}
            >
              <option value="">انتخاب دسته‌بندی</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.title}
                </option>
              ))}
            </select>
            {/* ponytail: leaving the form drops what was typed; an inline
                create beside the select is the upgrade if that bites. */}
            {categories.length === 0 && (
              <p className="text-muted-foreground mt-1.5 text-xs">
                هنوز دسته‌بندی‌ای ساخته نشده است.{' '}
                <Link
                  href={PROTECTED_PATHS.CATEGORIES}
                  data-umami-event="admin-panel-product-form-categories-link"
                  className="text-accent-strong font-medium underline"
                >
                  ساخت دسته‌بندی
                </Link>
              </p>
            )}
          </Field>
        </div>

        <Field
          id={fid('benefit')}
          label="جمله مزیت"
          hint="یک خط کوتاه که روی کارت محصول دیده می‌شود"
          error={fieldErrors.benefit}
        >
          <input
            id={fid('benefit')}
            value={form.benefit}
            onChange={(e) => update('benefit', e.target.value)}
            placeholder="مناسب گوارش حساس"
            className={inputClass(fieldErrors.benefit)}
          />
        </Field>

        <Field
          id={fid('description')}
          label="توضیحات"
          error={fieldErrors.description}
        >
          <textarea
            id={fid('description')}
            rows={4}
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            className={inputClass(fieldErrors.description)}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field
            id={fid('price')}
            label="قیمت (تومان)"
            hint={money(form.price) ?? 'عدد صحیح، بدون جداکننده'}
            error={fieldErrors.price}
          >
            <input
              id={fid('price')}
              inputMode="numeric"
              dir="ltr"
              value={form.price}
              onChange={(e) => update('price', e.target.value)}
              className={`${inputClass(fieldErrors.price)} text-start`}
            />
          </Field>
          <Field
            id={fid('oldPrice')}
            label="قیمت قبلی (اختیاری)"
            hint={money(form.oldPrice) ?? 'برای نمایش برچسب تخفیف'}
            error={fieldErrors.oldPrice}
          >
            <input
              id={fid('oldPrice')}
              inputMode="numeric"
              dir="ltr"
              value={form.oldPrice}
              onChange={(e) => update('oldPrice', e.target.value)}
              className={`${inputClass(fieldErrors.oldPrice)} text-start`}
            />
          </Field>
          <Field
            id={fid('stock')}
            label="موجودی"
            hint="صفر یعنی ناموجود"
            error={fieldErrors.stock}
          >
            <input
              id={fid('stock')}
              inputMode="numeric"
              dir="ltr"
              value={form.stock}
              onChange={(e) => update('stock', e.target.value)}
              className={`${inputClass(fieldErrors.stock)} text-start`}
            />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1.5 block text-sm font-medium">
            نوع حیوان
          </legend>
          <div className="flex max-w-xs gap-2">
            {[
              { value: PET_TYPES.CAT, label: '🐱 گربه' },
              { value: PET_TYPES.DOG, label: '🐶 سگ' },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => update('petType', option.value)}
                aria-pressed={form.petType === option.value}
                className={`flex-1 rounded-xl border-2 py-2.5 text-sm font-medium transition-colors ${
                  form.petType === option.value
                    ? 'border-accent-strong bg-accent/10 text-accent-strong'
                    : 'border-border hover:border-accent-strong'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="bg-secondary/50 border-border flex items-start gap-3 rounded-xl border p-4">
          <input
            id={fid('isActive')}
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => update('isActive', e.target.checked)}
            className="accent-accent-strong mt-0.5 h-4 w-4"
          />
          <div>
            <label
              htmlFor={fid('isActive')}
              className="cursor-pointer font-medium"
            >
              نمایش در فروشگاه
            </label>
            <p className="text-muted-foreground mt-0.5 text-xs">
              محصولات حذف‌شده فقط غیرفعال می‌شوند تا سفارش‌های قبلی سالم بمانند.
            </p>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={busy}
            data-umami-event="admin-panel-product-save"
            className="bg-accent-strong hover:bg-accent-hover inline-flex items-center gap-2 rounded-xl px-6 py-3 font-bold text-white transition-colors disabled:opacity-60"
          >
            {busy && (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            )}
            ذخیره محصول
          </button>
          <button
            type="button"
            onClick={() => router.push(PROTECTED_PATHS.PRODUCTS)}
            className="border-border hover:bg-secondary rounded-xl border-2 px-5 py-3 font-medium transition-colors"
          >
            انصراف
          </button>
        </div>
      </form>
    </div>
  );
}

const inputClass = (error?: string) =>
  `bg-secondary h-12 w-full rounded-xl px-4 text-sm outline-none border ${
    error
      ? 'border-destructive'
      : 'border-border focus-visible:border-accent-strong'
  }`;

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-destructive mt-1.5 flex items-center gap-1 text-xs">
          <AlertCircle size={12} aria-hidden="true" /> {error}
        </p>
      ) : hint ? (
        <p className="text-muted-foreground mt-1.5 text-xs">{hint}</p>
      ) : null}
    </div>
  );
}
