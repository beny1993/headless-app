'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { AlertCircle, ChevronRight, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { ApiRequestError, postData, putData } from '@/lib/api-client';
import {
  MAX_EXTRA_CATEGORIES,
  productInputSchema,
  productUpdateInputSchema,
} from '@/lib/catalog/product-input';
import {
  PET_EMOJI,
  PET_LABELS,
  PET_TYPE_VALUES,
  normalizePetTypes,
  type PetType,
} from '@/lib/catalog/product-query';
import { SKU_SUFFIX_LENGTH, skuPreview } from '@/lib/catalog/sku';
import { VARIANT_LABEL_LIMIT } from '@/lib/catalog/variant';
import { parseFieldErrors } from '@/lib/checkout/field-errors';
import {
  API_PATHS,
  apiAdminProductImagesPath,
  apiAdminProductPath,
  PROTECTED_PATHS,
} from '@/lib/constant/paths';
import { formatToman, toAsciiDigits, toPersianDigits } from '@/lib/format';
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
  /** The main category. */
  categoryId: string;
  /** The others, in the order they were added. */
  extraCategoryIds: string[];
  /** The product this one is a variant of, or null. */
  variantOf: string | null;
  /** «۱۰ کیلوگرم», «قرمز» — set on a member and on its head. */
  variantLabel: string | null;
  petTypes: PetType[];
  isActive: boolean;
  /** The current image's storage key, if any, so the edit form can preview it. */
  imageKey: string | null;
};

/**
 * One category as the selects and the chips need it: `label` carries the «— »
 * that stands in for an indent inside a flat option list, `title` is the plain
 * one a chip shows. Both come from `categoryOptions`.
 */
export type CategoryOption = { id: string; title: string; label: string };

/** One candidate head for the «زیرمجموعه‌ی» select. */
export type VariantHeadOption = {
  id: string;
  title: string;
  /** Null when the candidate has no «نوع» of its own yet — offered, disabled. */
  variantLabel: string | null;
  /** What this head is filed as — a member picking it takes the same. */
  categoryId: string;
  petTypes: PetType[];
};

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
  variantHeads = [],
  hasMembers = false,
}: {
  categories: CategoryOption[];
  product?: ProductFormInitial;
  /** Products this one may be filed under: active, not themselves members. */
  variantHeads?: VariantHeadOption[];
  /** True when this product already has members, so it cannot become one. */
  hasMembers?: boolean;
}) {
  const router = useRouter();
  const isEdit = Boolean(product);
  const formId = useId();

  const [form, setForm] = useState({
    title: product?.title ?? '',
    slug: product?.slug ?? '',
    brand: product?.brand ?? '',
    description: product?.description ?? '',
    benefit: product?.benefit ?? '',
    price: product ? String(product.price) : '',
    oldPrice: product?.oldPrice != null ? String(product.oldPrice) : '',
    stock: product ? String(product.stock) : '',
    categoryId: product?.categoryId ?? '',
    extraCategoryIds: product?.extraCategoryIds ?? [],
    variantOf: product?.variantOf ?? '',
    variantLabel: product?.variantLabel ?? '',
    // A new product starts with neither pet pressed: with toggle semantics a
    // pre-pressed «گربه» turns an admin who presses only «سگ» into a silent
    // both-pets product. One expression — flip it to `[PET_TYPES.CAT]` to
    // preselect the cat again.
    petTypes: product?.petTypes ?? [],
    isActive: product?.isActive ?? true,
  });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(
    product?.imageKey ? imageSrc(product.imageKey) : null,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  /**
   * F2: the admin made one of their additional categories the main one, so its
   * chip is gone. Said beside the two controls it is about — their eye is on
   * the select they just changed, not on the chip row underneath it — and
   * cleared by the next change to either.
   */
  const [promotedTitle, setPromotedTitle] = useState<string | null>(null);

  const update = (
    key: keyof typeof form,
    value: string | boolean | string[] | PetType[],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: '' }));
    setPromotedTitle(null);
  };

  /** Picking a main category that is already an additional one removes it. */
  const chooseCategory = (categoryId: string) => {
    const promoted = form.extraCategoryIds.includes(categoryId)
      ? categories.find((category) => category.id === categoryId)
      : undefined;
    setForm((current) => ({
      ...current,
      categoryId,
      extraCategoryIds: current.extraCategoryIds.filter(
        (id) => id !== categoryId,
      ),
    }));
    setFieldErrors((current) => ({
      ...current,
      categoryId: '',
      extraCategoryIds: '',
    }));
    setPromotedTitle(promoted?.title ?? null);
  };

  const setExtras = (extraCategoryIds: string[]) =>
    update('extraCategoryIds', extraCategoryIds);

  /**
   * Picking a head files this product where the head is filed.
   *
   * The controls for those three fields are hidden below while this is set —
   * the shop lists heads, so a member's own filing could never reach a shelf —
   * but the body still has to satisfy the same schema as any other product, so
   * the values come with the head rather than being left blank. `ProductDao`
   * copies them again on the way in; this is what keeps the form honest, not
   * what makes the rule true.
   */
  const chooseHead = (variantOf: string) => {
    const head = variantHeads.find((candidate) => candidate.id === variantOf);
    setForm((current) => ({
      ...current,
      variantOf,
      ...(head ? { categoryId: head.categoryId, petTypes: head.petTypes } : {}),
    }));
    setFieldErrors((current) => ({
      ...current,
      variantOf: '',
      categoryId: '',
      petTypes: '',
    }));
    setPromotedTitle(null);
  };

  /** True once this product hangs off another: its filing is the head's. */
  const isMember = form.variantOf !== '';

  /** Add or remove one pet, keeping the stored order. */
  const togglePet = (pet: PetType) =>
    update(
      'petTypes',
      normalizePetTypes(
        form.petTypes.includes(pet)
          ? form.petTypes.filter((value) => value !== pet)
          : [...form.petTypes, pet],
      ),
    );

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
    brand: form.brand,
    description: form.description,
    benefit: form.benefit,
    price: numeric(form.price),
    oldPrice: form.oldPrice.trim() === '' ? null : numeric(form.oldPrice),
    stock: numeric(form.stock),
    categoryId: form.categoryId,
    extraCategoryIds: form.extraCategoryIds,
    // Empty select and empty field both mean «standalone», which is `null` in
    // the column — the same «cleared is never set» rule every optional text
    // field here follows.
    variantOf: form.variantOf === '' ? null : form.variantOf,
    variantLabel: form.variantLabel,
    petTypes: form.petTypes,
    isActive: form.isActive,
  });

  const onSubmit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

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
          toast.warning(
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
        // A refusal no field can show is the request's own failure: a toast.
        const message =
          unmapped.length > 0
            ? unmapped.join(' ')
            : Object.keys(fields).length === 0
              ? error.message
              : undefined;
        if (message) toast.error(message);
        return;
      }
      toast.error(error instanceof Error ? error.message : GENERIC_ERROR);
    }
  };

  const atExtraCategoryCap =
    form.extraCategoryIds.length >= MAX_EXTRA_CATEGORIES;

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
            hint={
              // The SKU is derived from this, so the convention matters: brand,
              // pet, product, then size, so two sizes never share a slug. The
              // example sits in <bdi> so the RTL sentence cannot reorder it.
              <>
                به ترتیب از چپ: برند، حیوان، نام محصول، وزن یا اندازه — با حروف
                کوچک انگلیسی و خط تیره؛ مثل{' '}
                <bdi className="font-mono">royal-canin-cat-sensible-2kg</bdi>.
                کد کالا از همین ساخته می‌شود. برای محصولی که هم گربه و هم سگ
                است، بخش حیوان را از نشانی حذف کن.
              </>
            }
            error={fieldErrors.slug}
          >
            <input
              id={fid('slug')}
              dir="ltr"
              value={form.slug}
              onChange={(e) => update('slug', e.target.value)}
              placeholder="royal-canin-cat-sensible-2kg"
              className={`${inputClass(fieldErrors.slug)} text-start`}
            />
          </Field>
          <Field
            id={fid('sku')}
            label="کد کالا (SKU)"
            hint={
              isEdit
                ? 'بعد از ساخت ثابت می‌ماند و روی اقلام سفارش ثبت می‌شود'
                : `از نشانی ساخته می‌شود؛ هنگام ذخیره ${toPersianDigits(SKU_SUFFIX_LENGTH)} نویسه تصادفی به آن اضافه می‌شود`
            }
            error={fieldErrors.sku}
          >
            {/* Server-owned: derived from the slug at create and never sent, so
                the field only shows it — a preview now, the saved code on edit. */}
            <input
              id={fid('sku')}
              dir="ltr"
              readOnly
              value={product ? product.sku : skuPreview(form.slug)}
              className={`${inputClass(fieldErrors.sku)} text-muted-foreground text-start`}
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
          {!isMember && (
            <Field
              id={fid('categoryId')}
              label="دسته‌بندی"
              error={fieldErrors.categoryId}
            >
              <select
                id={fid('categoryId')}
                value={form.categoryId}
                onChange={(e) => chooseCategory(e.target.value)}
                className={inputClass(fieldErrors.categoryId)}
              >
                <option value="">انتخاب دسته‌بندی</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
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
          )}
          {isMember && (
            <div className="border-border bg-secondary/40 rounded-xl border border-dashed p-3 sm:col-span-2">
              <p className="text-sm font-medium">دسته‌بندی و نوع حیوان</p>
              <p className="text-muted-foreground mt-1 text-xs">
                از محصول اصلی گرفته می‌شود. فروشگاه محصول اصلی را فهرست می‌کند،
                پس یک خانواده یک‌بار دسته‌بندی می‌شود؛ برای تغییر آن، محصول اصلی
                را ویرایش کن.
              </p>
            </div>
          )}
        </div>

        {/* A product family: one card in the shop, the sizes or smells picked on
            the product page. Both fields are optional and a product that uses
            neither behaves exactly as before. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id={fid('variantLabel')}
            label="نوع (اختیاری)"
            error={fieldErrors.variantLabel}
          >
            <input
              id={fid('variantLabel')}
              value={form.variantLabel}
              onChange={(e) => update('variantLabel', e.target.value)}
              className={inputClass(fieldErrors.variantLabel)}
              placeholder="مثلاً ۱۰ کیلوگرم یا قرمز"
              maxLength={VARIANT_LABEL_LIMIT}
            />
            <p className="text-muted-foreground mt-1.5 text-xs">
              اگر این محصول در چند اندازه، رنگ یا رایحه است، این‌جا نوعِ همین
              مورد را بنویس.
            </p>
          </Field>
          <Field
            id={fid('variantOf')}
            label="زیرمجموعه‌ی (اختیاری)"
            error={fieldErrors.variantOf}
          >
            <select
              id={fid('variantOf')}
              value={form.variantOf}
              onChange={(e) => chooseHead(e.target.value)}
              className={inputClass(fieldErrors.variantOf)}
              // A product that already has members cannot itself become one:
              // only one level is allowed, and moving it would orphan them.
              disabled={hasMembers}
            >
              <option value="">هیچ‌کدام — محصول مستقل</option>
              {variantHeads.map((head) => (
                <option
                  key={head.id}
                  value={head.id}
                  // A head with no «نوع» of its own would render an empty chip,
                  // so it is shown but refused — the reason is in the hint.
                  disabled={!head.variantLabel?.trim()}
                >
                  {head.variantLabel
                    ? `${head.title} — ${head.variantLabel}`
                    : `${head.title} (اول «نوع» آن را پر کن)`}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground mt-1.5 text-xs">
              {hasMembers
                ? 'این محصول خودش زیرمجموعه دارد، پس نمی‌تواند زیرمجموعه‌ی محصول دیگری باشد.'
                : 'فقط یک سطح: محصولی که خودش زیرمجموعه است در این فهرست نیست.'}
            </p>
            {/* The one place the row's member-ness is declared, so the one
                place to say what follows from it. */}
            {isMember && (
              <p className="text-muted-foreground mt-1.5 text-xs">
                دسته‌بندی و نوع حیوان از همین محصول اصلی گرفته می‌شود.
              </p>
            )}
          </Field>
        </div>

        {/* Its own full-width block under the main category, so the two read
            top-to-bottom as one decision — not a second cell in that row,
            which would make the main category look like one of two equals.
            Chips plus an add-select rather than a checkbox list: a real
            catalogue reaches dozens of categories with sub-categories, and the
            admin is choosing at most five. */}
        {!isMember && (
          <fieldset aria-describedby={fid('extraCategoryIds-note')}>
            <legend className="mb-1.5 block text-sm font-medium">
              دسته‌بندی‌های دیگر (اختیاری)
            </legend>
            {/* Always rendered, so adding and removing are announced — the
                select snapping back to its placeholder says nothing by itself. */}
            <ul aria-live="polite" className="flex flex-wrap gap-2">
              {form.extraCategoryIds.map((id) => {
                const title =
                  categories.find((category) => category.id === id)?.title ??
                  id;
                return (
                  <li
                    key={id}
                    className="border-border flex h-11 items-center rounded-xl border ps-3 text-sm"
                  >
                    {title}
                    <button
                      type="button"
                      onClick={() =>
                        setExtras(
                          form.extraCategoryIds.filter((kept) => kept !== id),
                        )
                      }
                      aria-label={`حذف ${title} از دسته‌بندی‌های دیگر`}
                      data-umami-event="admin-panel-product-category-extra-remove"
                      className="text-muted-foreground hover:text-foreground flex h-11 w-9 items-center justify-center"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {/* A placeholder option is not a label. */}
            <label htmlFor={fid('extraCategoryIds')} className="sr-only">
              افزودن دسته‌بندی دیگر
            </label>
            {/* An action, not a value: it stays on its placeholder and pushes
                what was chosen onto the list. The main category and the chosen
                ones are removed from the options rather than disabled — there is
                no rule to teach here, they are simply already used. */}
            <select
              id={fid('extraCategoryIds')}
              value=""
              disabled={atExtraCategoryCap}
              onChange={(e) =>
                setExtras([...form.extraCategoryIds, e.target.value])
              }
              data-umami-event="admin-panel-product-category-extra-add"
              className={`${inputClass(fieldErrors.extraCategoryIds)} mt-2 disabled:opacity-60`}
            >
              <option value="">افزودن دسته‌بندی…</option>
              {categories
                .filter(
                  (category) =>
                    category.id !== form.categoryId &&
                    !form.extraCategoryIds.includes(category.id),
                )
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
            </select>
            <HintOrError
              id={fid('extraCategoryIds-note')}
              hint={
                promotedTitle
                  ? `«${promotedTitle}» از دسته‌بندی‌های دیگر برداشته شد؛ حالا دسته‌بندی اصلی است.`
                  : atExtraCategoryCap
                    ? `سقف ${toPersianDigits(MAX_EXTRA_CATEGORIES)} دسته‌بندی دیگر پر شده است؛ برای افزودن، یکی را حذف کن.`
                    : `اگر محصول در دسته‌بندی دیگری هم جا می‌گیرد، اینجا اضافه کن. حداکثر ${toPersianDigits(MAX_EXTRA_CATEGORIES)} تا.`
              }
              error={fieldErrors.extraCategoryIds}
            />
          </fieldset>
        )}

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

        {/* Two independent `aria-pressed` toggles already are multi-select
            semantics — a pressed toggle is a button, not a radio — so «both»
            needs the handler to toggle rather than replace, and nothing else.
            The fieldset's legend is the group's label. */}
        {!isMember && (
          <fieldset aria-describedby={fid('petTypes-note')}>
            <legend className="mb-1.5 block text-sm font-medium">
              نوع حیوان
            </legend>
            <div className="flex max-w-xs gap-2">
              {PET_TYPE_VALUES.map((value) => ({
                value,
                label: `${PET_EMOJI[value]} ${PET_LABELS[value]}`,
              })).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => togglePet(option.value)}
                  aria-pressed={form.petTypes.includes(option.value)}
                  data-umami-event={`admin-panel-product-pet-${option.value}`}
                  className={`flex-1 rounded-xl border-2 py-2.5 text-sm font-medium transition-colors ${
                    form.petTypes.includes(option.value)
                      ? 'border-accent-strong bg-accent/10 text-accent-strong'
                      : 'border-border hover:border-accent-strong'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {/* Deselecting the last pet is allowed and refused on submit with
                every other field: silently ignoring the click says nothing. */}
            <HintOrError
              id={fid('petTypes-note')}
              hint="یکی یا هر دو را انتخاب کن"
              error={fieldErrors.petTypes}
            />
          </fieldset>
        )}

        <div className="bg-secondary/50 border-border flex items-start gap-3 rounded-xl border p-4">
          <input
            id={fid('isActive')}
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => update('isActive', e.target.checked)}
            // Hiding a head hides its whole family — the members are never
            // listed on their own, so they would stay live and purchasable by
            // URL on no shelf. The DAO refuses it; disabling here says so
            // before the round trip, the way the «زیرمجموعه‌ی» select does.
            disabled={hasMembers}
            className="accent-accent-strong mt-0.5 h-4 w-4 disabled:opacity-50"
          />
          <div>
            <label
              htmlFor={fid('isActive')}
              className="cursor-pointer font-medium"
            >
              نمایش در فروشگاه
            </label>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {hasMembers
                ? 'این محصول زیرمجموعه فعال دارد؛ تا وقتی آن‌ها فعال‌اند نمی‌توانی پنهانش کنی.'
                : 'محصولات حذف‌شده فقط غیرفعال می‌شوند تا سفارش‌های قبلی سالم بمانند.'}
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
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      <HintOrError hint={hint} error={error} />
    </div>
  );
}

/** One slot under a control: its error if it has one, otherwise its hint. */
function HintOrError({
  id,
  hint,
  error,
}: {
  id?: string;
  hint?: React.ReactNode;
  error?: string;
}) {
  if (error) {
    return (
      <p
        id={id}
        className="text-destructive mt-1.5 flex items-center gap-1 text-xs"
      >
        <AlertCircle size={12} aria-hidden="true" /> {error}
      </p>
    );
  }
  if (!hint) return null;
  return (
    <p id={id} className="text-muted-foreground mt-1.5 text-xs">
      {hint}
    </p>
  );
}
