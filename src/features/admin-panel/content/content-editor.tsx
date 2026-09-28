'use client';

import { useId, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { DEFAULT_ERROR_MESSAGE, putData } from '@/lib/api-client';
import { reasonFrom, requestFieldErrors } from '@/lib/checkout/field-errors';
import { apiAdminContentPath } from '@/lib/constant/paths';
import { HOME_CATEGORY_TILES, homeTiles } from '@/lib/catalog/category-tree';
import {
  CONTENT_SCHEMAS,
  MAX_ROUTINE_CATEGORIES,
  type ContentKey,
  type ContentValues,
} from '@/lib/content/site-content';
import type { Link, LinkTargets } from '@/lib/content/link';
import { imageSrc } from '@/lib/storage/image-url';
import {
  ImagePicker,
  uploadImage,
  validateImageFile,
} from '@/features/admin-panel/shared/image-picker';
import { controlClass, fieldAria, FieldShell } from '@/components/ui/field';
import {
  BLOCK_FIELDS,
  getPath,
  setPath,
  type FieldDescriptor,
} from './block-fields';
import {
  CategoryPicker,
  LinkPicker,
  ProductPicker,
  type LinkOptions,
} from './link-picker';

/**
 * The storefront content editor for one area: one independent form per block in
 * `keys` (page order), each pre-filled from its row-or-default value and saved on
 * its own. Reuses the product form's stack — `useState` + a zod `safeParse` before
 * send + `putData` + the shared `requestFieldErrors` for server refusals — so there is
 * no form library and no new mechanism here; the block-specific part is entirely
 * data (BLOCK_FIELDS). The `[area]` page hands it just its own area's keys, and
 * the categories and active products its destination pickers offer — plus the
 * listed ones, for the featured boxes.
 */
export function ContentEditor<K extends ContentKey>({
  keys,
  values,
  options,
}: {
  keys: readonly K[];
  values: Pick<ContentValues, K>;
  options: LinkOptions;
}) {
  // The pickers preview each destination against the same id → slug maps the
  // storefront resolves with, built from the options the page loaded.
  const targets: LinkTargets = {
    categories: Object.fromEntries(
      options.categories.map(({ id, slug }) => [id, slug]),
    ),
    products: Object.fromEntries(
      options.products.map(({ id, slug }) => [id, slug]),
    ),
  };

  return (
    <div className="flex flex-col gap-6">
      {keys.map((key) => (
        <BlockForm
          key={key}
          contentKey={key}
          initial={values[key]}
          options={options}
          targets={targets}
        />
      ))}
    </div>
  );
}

/** Whether a block's schema carries a `visible` toggle — derived, not a table. */
function hasVisibleToggle(key: ContentKey): boolean {
  return (
    'visible' in (CONTENT_SCHEMAS[key] as unknown as { shape: object }).shape
  );
}

function BlockForm({
  contentKey,
  initial,
  options,
  targets,
}: {
  contentKey: ContentKey;
  initial: ContentValues[ContentKey];
  options: LinkOptions;
  targets: LinkTargets;
}) {
  const formId = useId();
  const [value, setValue] = useState<ContentValues[ContentKey]>(initial);
  // Pending image picks, keyed by the image field's path; adopted into `value`
  // as storage keys on save. `previews` holds their blob URLs for display.
  const [files, setFiles] = useState<Record<string, File>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [justSaved, setJustSaved] = useState(false);

  const block = BLOCK_FIELDS[contentKey];
  const showToggle = hasVisibleToggle(contentKey);
  const fid = (path: string) => `${formId}-${path}`;

  const setField = (path: string, next: string) => {
    setValue((current) => setPath(current, path, next));
    setFieldErrors((current) => ({ ...current, [path]: '' }));
    setJustSaved(false);
  };

  // A picker replaces the whole destination at its path and clears every error
  // under it — a bad URL is reported at `ctaLink.url`, the `ctaLink` picker's own.
  const setDestination = (path: string, next: unknown) => {
    setValue((current) => setPath(current, path, next));
    setFieldErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([key]) => key !== path && !key.startsWith(`${path}.`),
        ),
      ),
    );
    setJustSaved(false);
  };

  // The section-visibility switch. `visible` is optional and read as "hidden only
  // when explicitly false", so an unchecked box stores `false` and a checked one
  // `true`; either way the value round-trips through the same save path.
  const shown = getPath(value, 'visible') !== false;
  const setVisible = (next: boolean) => {
    setValue((current) => setPath(current, 'visible', next));
    setJustSaved(false);
  };

  const pickImage = (path: string, chosen: File | undefined) => {
    if (!chosen) return;
    const invalid = validateImageFile(chosen);
    if (invalid) {
      setFieldErrors((current) => ({ ...current, [path]: invalid }));
      return;
    }
    setFieldErrors((current) => ({ ...current, [path]: '' }));
    setFiles((current) => ({ ...current, [path]: chosen }));
    setPreviews((current) => ({
      ...current,
      [path]: URL.createObjectURL(chosen),
    }));
    setJustSaved(false);
  };

  const onSubmit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving.current) return;

    // (1) Validate the current value. Pending image picks are not yet in it, but
    // their fields still hold the previous (valid) key, so the schema passes and
    // the upload runs next; the server re-validates the final body regardless.
    const schema = CONTENT_SCHEMAS[contentKey] as z.ZodType;
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.');
        if (path && !(path in errors)) errors[path] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    saving.current = true;
    setBusy(true);

    // (2) Upload each pending file, adopting the returned key into a local copy
    // and dropping it from the pending set as we go — so a later failure leaves
    // the already-uploaded keys in place and a retry never re-uploads them.
    let next = value;
    const remainingFiles = { ...files };
    const remainingPreviews = { ...previews };
    // Either failure keeps what was uploaded on the form, pending picks intact.
    const restore = () => {
      setValue(next);
      setFiles(remainingFiles);
      setPreviews(remainingPreviews);
    };
    try {
      try {
        for (const [path, file] of Object.entries(files)) {
          const key = await uploadImage(file);
          next = setPath(next, path, key);
          delete remainingFiles[path];
          delete remainingPreviews[path];
        }
      } catch (error) {
        restore();
        toast.error(reasonFrom(error) ?? DEFAULT_ERROR_MESSAGE);
        return;
      }

      // (3) Save the block. Adopt the stored value back, so the form now
      // reflects exactly what is persisted (new image keys included) and
      // pending picks clear.
      try {
        const saved = await putData<{
          key: string;
          value: ContentValues[ContentKey];
        }>(apiAdminContentPath(contentKey), next);
        setValue(saved.value);
        setFiles({});
        setPreviews({});
        setFieldErrors({});
        setJustSaved(true);
      } catch (error) {
        restore();
        // A refusal no field can show is the request's own failure: a toast.
        const { fields, message } = requestFieldErrors(error);
        setFieldErrors(fields);
        if (message) toast.error(message);
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="border-border rounded-2xl border bg-white p-6"
    >
      <h2 className="mb-4 text-lg font-black">{block.title}</h2>

      {/* Lock the snapshot being saved, including image picks, until upload and
          persistence finish; a response must never overwrite newer local edits. */}
      <fieldset disabled={busy} className="min-w-0">
        {/* The toggle appears only for blocks whose schema carries `visible` — the
          Home/About content sections. Chrome (header/footer) has no such field,
          so it gets no toggle: the header and footer are always rendered. */}
        {showToggle && (
          <label
            htmlFor={fid('visible')}
            className="mb-5 flex w-fit items-center gap-2 text-sm font-medium"
          >
            <input
              id={fid('visible')}
              type="checkbox"
              checked={shown}
              onChange={(e) => setVisible(e.target.checked)}
              data-umami-event="admin-panel-content-visibility-toggle"
              className="size-4 shrink-0"
            />
            نمایش این بخش در سایت
          </label>
        )}

        <div className="space-y-5">
          {block.fields.map((field) =>
            field.kind === 'link' ? (
              <LinkPicker
                key={field.path}
                id={fid(field.path)}
                label={field.label}
                value={getPath(value, field.path) as Link | null | undefined}
                fallback={field.fallback ?? ''}
                options={options}
                targets={targets}
                error={errorUnder(fieldErrors, field.path)}
                onChange={(next) => setDestination(field.path, next)}
              />
            ) : field.kind === 'categories' && field.homeTiles ? (
              <CategoryPicker
                key={field.path}
                id={fid(field.path)}
                label={field.label}
                value={getPath(value, field.path) as string[] | undefined}
                fallback={field.fallback ?? ''}
                categories={options.mainCategories}
                max={HOME_CATEGORY_TILES}
                umami={{
                  toggle: 'admin-panel-content-home-category-toggle',
                  reorder: 'admin-panel-content-home-category-reorder',
                }}
                shows={(picked) => homeTiles(options.mainCategories, picked)}
                error={errorUnder(fieldErrors, field.path)}
                onChange={(next) => setDestination(field.path, next)}
              />
            ) : field.kind === 'categories' ? (
              <CategoryPicker
                key={field.path}
                id={fid(field.path)}
                label={field.label}
                value={getPath(value, field.path) as string[] | undefined}
                fallback={field.fallback ?? ''}
                categories={options.categories}
                max={MAX_ROUTINE_CATEGORIES}
                umami={{
                  toggle: 'admin-panel-content-routine-category-toggle',
                  reorder: 'admin-panel-content-routine-category-reorder',
                }}
                error={errorUnder(fieldErrors, field.path)}
                onChange={(next) => setDestination(field.path, next)}
              />
            ) : field.kind === 'products' ? (
              <ProductPicker
                key={field.path}
                id={fid(field.path)}
                label={field.label}
                value={
                  getPath(value, field.path) as (string | null)[] | undefined
                }
                fallback={field.fallback ?? ''}
                products={options.cards}
                error={errorUnder(fieldErrors, field.path)}
                onChange={(next) => setDestination(field.path, next)}
              />
            ) : (
              <BlockField
                key={field.path}
                field={field}
                id={fid(field.path)}
                value={String(getPath(value, field.path) ?? '')}
                preview={
                  previews[field.path] ??
                  imageSrc(String(getPath(value, field.path) ?? ''))
                }
                error={fieldErrors[field.path]}
                onText={(next) => setField(field.path, next)}
                onPick={(file) => pickImage(field.path, file)}
              />
            ),
          )}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            data-umami-event="admin-panel-content-save"
            className="bg-accent-strong hover:bg-accent-hover inline-flex items-center gap-2 rounded-xl px-6 py-3 font-bold text-white transition-colors disabled:opacity-60"
          >
            {busy && (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            )}
            ذخیره
          </button>
          {justSaved && (
            <span className="text-accent-strong flex items-center gap-1 text-sm font-medium">
              <Check size={16} aria-hidden="true" /> ذخیره شد
            </span>
          )}
        </div>
      </fieldset>
    </form>
  );
}

function BlockField({
  field,
  id,
  value,
  preview,
  error,
  onText,
  onPick,
}: {
  field: FieldDescriptor;
  id: string;
  value: string;
  preview: string | null;
  error?: string;
  onText: (next: string) => void;
  onPick: (file: File | undefined) => void;
}) {
  if (field.kind === 'image') {
    return (
      <ImagePicker
        id={id}
        label={field.label}
        preview={preview}
        error={error}
        buttonLabel="تغییر تصویر"
        onPick={onPick}
        umami="admin-panel-content-image-pick"
      />
    );
  }

  const control = {
    id,
    value,
    ...fieldAria(id, error),
    className: controlClass(Boolean(error)),
  };
  return (
    <FieldShell id={id} label={field.label} error={error}>
      {field.kind === 'textarea' ? (
        <textarea
          {...control}
          rows={3}
          onChange={(e) => onText(e.target.value)}
        />
      ) : (
        <input {...control} onChange={(e) => onText(e.target.value)} />
      )}
    </FieldShell>
  );
}

/** The first error at `path` or under it (`ctaLink.url` belongs to `ctaLink`). */
const errorUnder = (errors: Record<string, string>, path: string) =>
  errors[path] ||
  Object.entries(errors).find(
    ([key, message]) => message && key.startsWith(`${path}.`),
  )?.[1];
