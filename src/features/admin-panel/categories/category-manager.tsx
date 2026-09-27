'use client';

import {
  useEffect,
  useId,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import Image from 'next/image';
import {
  Check,
  CornerDownLeft,
  Layers,
  Loader2,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { delData, postData, putData } from '@/lib/api-client';
import {
  CATEGORY_PARENT_MESSAGES,
  type CategoryInputBody,
  categoryInputSchema,
} from '@/lib/catalog/category-input';
import { orderAsTree } from '@/lib/catalog/category-tree';
import {
  reasonFrom,
  requestFieldErrors,
  zodFieldErrors,
} from '@/lib/checkout/field-errors';
import { API_PATHS, apiAdminCategoryPath } from '@/lib/constant/paths';
import { formatNumber, parseDigits } from '@/lib/format';
import type { CategoryView } from '@/lib/hono/routes/admin-categories';
import { imageSrc } from '@/lib/storage/image-url';
import { cn } from '@/lib/utils';
import { AdminTable } from '@/features/admin-panel/shared/admin-table';
import { CreateCard } from '@/features/admin-panel/shared/create-card';
import {
  ImagePicker,
  uploadImage,
  validateImageFile,
} from '@/features/admin-panel/shared/image-picker';
import {
  COMPACT_CONTROL,
  controlClass,
  fieldAria,
  FieldShell,
  TextField,
} from '@/components/ui/field';

/**
 * The admin category manager: a create form over the live list, each row
 * editable in place and deletable. Same-origin JSON calls to the `/api/admin/*`
 * routes behind `requireAdmin` — the gating here is cosmetic, the real boundary
 * is that guard. Validation reuses the shared `categoryInputSchema`, so the form
 * and the API cannot drift.
 *
 * A row's edit fields exist only while it is in edit mode, seeded when editing
 * starts; a successful save leaves edit mode, so the next edit reads the fresh
 * row. No field mirrors a prop across a save.
 */
type Draft = {
  title: string;
  slug: string;
  sortOrder: string;
  /** The select's value — `''` is «no parent», which the schema reads as null. */
  parentId: string;
  /**
   * The saved photo's key, `null` for none or once removed. A fresh pick waits
   * beside the draft (`usePhotoPick`) until the save uploads it.
   */
  imageKey: string | null;
};

type SaveResult =
  | { ok: true; category: CategoryView }
  | { ok: false; fields: Record<string, string>; message?: string };

const EMPTY_DRAFT: Draft = {
  title: '',
  slug: '',
  sortOrder: '0',
  parentId: '',
  imageKey: null,
};

const GENERIC_ERROR = 'ذخیره دسته‌بندی ناموفق بود. دوباره تلاش کن.';

// ponytail: ties on sortOrder sort by `localeCompare('fa')`, which can differ
// from Postgres's collation; a reload shows the server's order.
const byStorefrontOrder = (a: CategoryView, b: CategoryView) =>
  a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'fa');

/**
 * Validate a draft against the shared contract, send it, and map any refusal
 * back onto fields — the one save path for both create and edit.
 *
 * A picked `photo` uploads only once the rest of the draft is valid, and its
 * key goes to `adopt` before the category is sent — so a refused save retries
 * with that key rather than uploading the file again (the content editor's
 * order).
 */
async function saveCategory(
  draft: Draft,
  photo: File | null,
  adopt: (imageKey: string) => void,
  send: (body: CategoryInputBody) => Promise<CategoryView>,
): Promise<SaveResult> {
  const parsed = categoryInputSchema.safeParse({
    title: draft.title,
    slug: draft.slug,
    sortOrder: parseDigits(draft.sortOrder) ?? Number.NaN,
    // `z.uuid()` refuses `''`; the empty option means top-level.
    parentId: draft.parentId === '' ? null : draft.parentId,
    imageKey: draft.imageKey,
  });
  if (!parsed.success) {
    return { ok: false, fields: zodFieldErrors(parsed.error) };
  }

  try {
    let body = parsed.data;
    if (photo) {
      const imageKey = await uploadImage(photo);
      adopt(imageKey);
      body = { ...body, imageKey };
    }
    return { ok: true, category: await send(body) };
  } catch (error) {
    return { ok: false, ...requestFieldErrors(error, GENERIC_ERROR) };
  }
}

/**
 * The photo a form has picked but not yet saved, with its `blob:` preview. The
 * effect's cleanup revokes the blob exactly when it is replaced, dropped or
 * unmounted — a pick is never displayed from a revoked URL, and none leaks.
 */
function usePhotoPick() {
  const [pick, setPick] = useState<{ file: File; preview: string } | null>(
    null,
  );
  useEffect(() => {
    if (!pick) return;
    return () => URL.revokeObjectURL(pick.preview);
  }, [pick]);

  const choose = (file: File | null) =>
    setPick(file && { file, preview: URL.createObjectURL(file) });
  return [pick, choose] as const;
}

/**
 * The picker's `onPick`: an acceptable file becomes the pick, a refused one
 * stays off the form with its Persian reason on the field — the server
 * re-sniffs the bytes regardless.
 */
function pickPhoto(
  file: File | undefined,
  choose: (file: File) => void,
  setErrors: Dispatch<SetStateAction<Record<string, string>>>,
) {
  if (!file) return;
  const invalid = validateImageFile(file);
  setErrors((current) => ({ ...current, imageKey: invalid ?? '' }));
  if (!invalid) choose(file);
}

/** What the photo slot shows: a fresh pick, else the saved photo, else none. */
const previewOf = (
  pick: { preview: string } | null,
  imageKey: string | null,
): string | null => pick?.preview ?? (imageKey ? imageSrc(imageKey) : null);

export function CategoryManager({
  initialCategories,
}: {
  initialCategories: CategoryView[];
}) {
  const [categories, setCategories] = useState(initialCategories);

  const onSaved = (saved: CategoryView) =>
    setCategories((prev) =>
      [...prev.filter((c) => c.id !== saved.id), saved].sort(byStorefrontOrder),
    );
  const onDeleted = (id: string) =>
    setCategories((prev) => prev.filter((c) => c.id !== id));

  // Only a top-level category may be a parent, and only one level deep — the
  // same rule `CategoryDao` enforces, so the UI never offers a save it refuses.
  const parents = categories.filter((c) => c.parentId === null);

  return (
    // `min-w-0`: a flex item holding a wide table; without it the table's
    // `overflow-x-auto` never scrolls and the page overflows at narrow widths.
    <div className="flex min-w-0 flex-col gap-6">
      <CreateForm parents={parents} onCreated={onSaved} />
      <CategoryTable
        categories={categories}
        parents={parents}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    </div>
  );
}

function CreateForm({
  parents,
  onCreated,
}: {
  parents: CategoryView[];
  onCreated: (created: CategoryView) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [pick, choosePhoto] = usePhotoPick();

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErrors({});
    setJustCreated(null);
    const result = await saveCategory(
      draft,
      pick?.file ?? null,
      (imageKey) => {
        setDraft((d) => ({ ...d, imageKey }));
        choosePhoto(null);
      },
      (body) => postData<CategoryView>(API_PATHS.ADMIN_CATEGORIES, body),
    );
    setBusy(false);
    if (!result.ok) {
      setErrors(result.fields);
      if (result.message) toast.error(result.message);
      return;
    }
    onCreated(result.category);
    setJustCreated(result.category.title);
    setDraft(EMPTY_DRAFT);
  };

  return (
    <CreateCard
      title="ساخت دسته‌بندی"
      icon={
        <Layers size={18} className="text-accent-strong" aria-hidden="true" />
      }
      onSubmit={submit}
      busy={busy}
      done={justCreated && <>«{justCreated}» ساخته شد</>}
      submitLabel="ساخت دسته‌بندی"
      umami="admin-panel-categories-create"
    >
      <TextField
        id={`${id}-title`}
        label="عنوان"
        value={draft.title}
        onChange={(title) => setDraft((d) => ({ ...d, title }))}
        error={errors.title}
        placeholder="مثل غذای خشک"
        umami="admin-panel-categories-title"
      />
      <TextField
        id={`${id}-slug`}
        label="نشانی (slug)"
        value={draft.slug}
        onChange={(slug) => setDraft((d) => ({ ...d, slug }))}
        error={errors.slug}
        hint="در آدرس فروشگاه، مثل dry-food"
        dir="ltr"
        umami="admin-panel-categories-slug"
      />
      <TextField
        id={`${id}-sort`}
        label="ترتیب نمایش"
        value={draft.sortOrder}
        onChange={(sortOrder) => setDraft((d) => ({ ...d, sortOrder }))}
        error={errors.sortOrder}
        hint="عدد کمتر، اول نمایش داده می‌شود"
        dir="ltr"
        inputMode="numeric"
        umami="admin-panel-categories-sort"
      />
      <ParentField
        id={`${id}-parent`}
        value={draft.parentId}
        onChange={(parentId) => setDraft((d) => ({ ...d, parentId }))}
        parents={parents}
        error={errors.parentId}
        umami="admin-panel-categories-parent"
      />
      <PhotoField
        id={`${id}-image`}
        preview={previewOf(pick, draft.imageKey)}
        error={errors.imageKey}
        disabled={busy}
        onPick={(file) => pickPhoto(file, choosePhoto, setErrors)}
        onRemove={() => {
          choosePhoto(null);
          setDraft((d) => ({ ...d, imageKey: null }));
        }}
        umami="admin-panel-categories-image"
      />
    </CreateCard>
  );
}

function CategoryTable({
  categories,
  parents,
  onSaved,
  onDeleted,
}: {
  categories: CategoryView[];
  parents: CategoryView[];
  onSaved: (saved: CategoryView) => void;
  onDeleted: (id: string) => void;
}) {
  if (categories.length === 0) {
    return (
      <div className="border-border bg-secondary/40 text-muted-foreground rounded-2xl border py-16 text-center text-sm">
        هنوز دسته‌بندی‌ای ساخته نشده است. اولین دسته‌بندی را بساز تا بتوانی
        محصول اضافه کنی.
      </div>
    );
  }

  return (
    <AdminTable
      headings={['تصویر', 'عنوان', 'نشانی (slug)', 'ترتیب نمایش']}
      actions="عملیات"
    >
      {/* Sub-rows sit directly under their parent — the nesting *is* the
          count, so no badge. */}
      {orderAsTree(categories).map(({ depth, ...category }) => (
        <CategoryRow
          key={category.id}
          category={category}
          depth={depth}
          parentTitle={parents.find((p) => p.id === category.parentId)?.title}
          // A category with children cannot itself become one.
          hasChildren={categories.some((c) => c.parentId === category.id)}
          parents={parents.filter((p) => p.id !== category.id)}
          onSaved={onSaved}
          onDeleted={onDeleted}
        />
      ))}
    </AdminTable>
  );
}

function CategoryRow({
  category,
  depth,
  parentTitle,
  hasChildren,
  parents,
  onSaved,
  onDeleted,
}: {
  category: CategoryView;
  depth: 0 | 1;
  parentTitle?: string;
  hasChildren: boolean;
  /** Every top-level category but this one. */
  parents: CategoryView[];
  onSaved: (saved: CategoryView) => void;
  onDeleted: (id: string) => void;
}) {
  const id = useId();
  // `null` outside edit mode — see the component note above.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pick, choosePhoto] = usePhotoPick();

  const clearErrors = () => setErrors({});

  const startEdit = () => {
    clearErrors();
    setDraft({
      title: category.title,
      slug: category.slug,
      sortOrder: String(category.sortOrder),
      parentId: category.parentId ?? '',
      imageKey: category.imageKey,
    });
  };

  const cancel = () => {
    clearErrors();
    setDraft(null);
    choosePhoto(null);
  };

  const save = async () => {
    if (!draft || busy) return;
    setBusy(true);
    clearErrors();
    const result = await saveCategory(
      draft,
      pick?.file ?? null,
      (imageKey) => {
        setDraft((d) => d && { ...d, imageKey });
        choosePhoto(null);
      },
      (body) => putData<CategoryView>(apiAdminCategoryPath(category.id), body),
    );
    setBusy(false);
    if (!result.ok) {
      setErrors(result.fields);
      if (result.message) toast.error(result.message);
      return;
    }
    setDraft(null);
    onSaved(result.category);
  };

  const remove = async () => {
    if (
      busy ||
      !window.confirm(
        `دسته‌بندی «${category.title}» حذف شود؟ این کار برگشت‌پذیر نیست.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await delData(apiAdminCategoryPath(category.id));
      onDeleted(category.id);
    } catch (requestError) {
      // A 409 carries the server's Persian refusal, naming the product count.
      toast.error(reasonFrom(requestError) ?? 'حذف دسته‌بندی ناموفق بود.');
      setBusy(false);
    }
  };

  const actionButton =
    'border-border hover:bg-secondary inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

  /** Logical padding, so the indent stays on the correct side in RTL. */
  const titleCell = cn('px-4 py-3', depth === 1 && 'ps-8');

  return (
    <tr className="border-border border-t align-top">
      <td className="px-4 py-3">
        {/* The saved photo, in both modes — the products list's thumbnail, so
            a category still missing its home-tile photo shows at a glance. */}
        <div className="bg-muted relative h-10 w-10 overflow-hidden rounded-lg">
          {category.imageKey && (
            <Image
              src={imageSrc(category.imageKey)}
              alt=""
              fill
              sizes="40px"
              className="object-cover"
            />
          )}
          <span className="sr-only">
            {category.imageKey ? 'دارای تصویر' : 'بدون تصویر'}
          </span>
        </div>
      </td>
      {draft ? (
        <>
          <td className={titleCell}>
            <TextField
              id={`${id}-title`}
              label="عنوان"
              hideLabel
              compact
              value={draft.title}
              onChange={(title) => setDraft({ ...draft, title })}
              error={errors.title}
              umami="admin-panel-categories-row-title"
            />
            {/* Under the title rather than in a new column: the table is
                already sideways-scrollable at 375px. */}
            <ParentField
              id={`${id}-parent`}
              hideLabel
              compact
              value={draft.parentId}
              onChange={(parentId) => setDraft({ ...draft, parentId })}
              parents={parents}
              disabled={hasChildren}
              // Disabled, never hidden: a control that vanishes teaches the
              // admin nothing, one with a reason teaches the rule.
              hint={
                hasChildren ? CATEGORY_PARENT_MESSAGES.hasChildren : undefined
              }
              error={errors.parentId}
              umami="admin-panel-categories-row-parent"
            />
            {/* Here too, not in the thumbnail's column: a picker there takes
                the width the parent select needs, even at 1280px. */}
            <div className="mt-3">
              <PhotoField
                id={`${id}-image`}
                preview={previewOf(pick, draft.imageKey)}
                error={errors.imageKey}
                disabled={busy}
                onPick={(file) => pickPhoto(file, choosePhoto, setErrors)}
                onRemove={() => {
                  choosePhoto(null);
                  setDraft({ ...draft, imageKey: null });
                }}
                umami="admin-panel-categories-row-image"
              />
            </div>
          </td>
          <td className="px-4 py-3">
            <TextField
              id={`${id}-slug`}
              label="نشانی (slug)"
              hideLabel
              compact
              dir="ltr"
              value={draft.slug}
              onChange={(slug) => setDraft({ ...draft, slug })}
              error={errors.slug}
              umami="admin-panel-categories-row-slug"
            />
          </td>
          <td className="px-4 py-3">
            <TextField
              id={`${id}-sort`}
              label="ترتیب نمایش"
              hideLabel
              compact
              dir="ltr"
              inputMode="numeric"
              value={draft.sortOrder}
              onChange={(sortOrder) => setDraft({ ...draft, sortOrder })}
              error={errors.sortOrder}
              umami="admin-panel-categories-row-sort"
            />
          </td>
        </>
      ) : (
        <>
          <td className={cn(titleCell, 'font-medium')}>
            {depth === 1 && (
              <>
                {/* Not mirrored in RTL: the glyph already reads
                    down-from-the-parent, then toward the title. */}
                <CornerDownLeft
                  size={14}
                  className="text-muted-foreground me-1.5 inline"
                  aria-hidden="true"
                />
                {/* The indent is invisible to a screen reader, so the nesting
                    is said out loud instead. */}
                <span className="sr-only">زیردسته‌ی {parentTitle} — </span>
              </>
            )}
            {category.title}
          </td>
          <td className="px-4 py-3 font-mono" dir="ltr">
            {category.slug}
          </td>
          <td className="nums px-4 py-3">{formatNumber(category.sortOrder)}</td>
        </>
      )}
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {draft ? (
            <>
              <button
                type="button"
                onClick={save}
                disabled={busy}
                data-umami-event="admin-panel-categories-save"
                className={actionButton}
              >
                {busy ? (
                  <Loader2
                    size={12}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Check size={12} aria-hidden="true" />
                )}
                ذخیره
              </button>
              <button
                type="button"
                onClick={cancel}
                disabled={busy}
                data-umami-event="admin-panel-categories-cancel"
                className={actionButton}
              >
                <X size={12} aria-hidden="true" />
                انصراف
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={startEdit}
                disabled={busy}
                aria-label={`ویرایش ${category.title}`}
                data-umami-event="admin-panel-categories-edit"
                className={actionButton}
              >
                <Pencil size={12} aria-hidden="true" />
                ویرایش
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                aria-label={`حذف ${category.title}`}
                data-umami-event="admin-panel-categories-delete"
                className={cn(
                  actionButton,
                  'text-destructive hover:bg-destructive-soft',
                )}
              >
                {busy ? (
                  <Loader2
                    size={12}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Trash2 size={12} aria-hidden="true" />
                )}
                حذف
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * The «تصویر دسته‌بندی» slot, in the create form and every edit row: the shared
 * picker, where the photo shows, and a remove button while there is a photo to
 * remove — the saved one or a fresh pick. Removing is local until the save, as
 * every other field here is.
 *
 * `disabled` while a save runs (the content editor's `<fieldset>`): the upload
 * brings back the key of the photo that was on screen at the click, and a
 * removal or a new pick made meanwhile would be silently overwritten by it.
 */
function PhotoField({
  id,
  preview,
  error,
  disabled,
  onPick,
  onRemove,
  umami,
}: {
  id: string;
  preview: string | null;
  error?: string;
  disabled: boolean;
  onPick: (file: File | undefined) => void;
  onRemove: () => void;
  umami: string;
}) {
  return (
    <fieldset
      disabled={disabled}
      className="flex min-w-60 flex-col items-start gap-2 disabled:opacity-60"
    >
      <ImagePicker
        id={id}
        label="تصویر دسته‌بندی"
        preview={preview}
        error={error}
        buttonLabel={preview ? 'تغییر تصویر' : 'انتخاب تصویر'}
        onPick={onPick}
        umami={umami}
      />
      <p className="text-muted-foreground text-xs">
        روی کاشی دسته‌بندی در صفحه‌ی اصلی دیده می‌شود (فقط دسته‌بندی‌های اصلی).
      </p>
      {preview && (
        <button
          type="button"
          onClick={() => {
            onRemove();
            // The button leaves with the photo; hand focus to the picker's
            // input, which stays, rather than dropping it on the page.
            document.getElementById(id)?.focus();
          }}
          data-umami-event={`${umami}-remove`}
          className="text-destructive hover:bg-destructive-soft inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors"
        >
          <X size={12} aria-hidden="true" />
          حذف تصویر
        </button>
      )}
    </fieldset>
  );
}

/**
 * The «دسته‌بندی مادر» select — one control for create, move and promote, in the
 * create form and in every edit row. A native `<select>`: the platform picker is
 * full-screen on mobile and type-ahead on desktop, and it costs no dependency.
 */
function ParentField({
  id,
  value,
  onChange,
  parents,
  error,
  hint,
  disabled,
  hideLabel,
  compact,
  umami,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  parents: CategoryView[];
  error?: string;
  hint?: string;
  disabled?: boolean;
  hideLabel?: boolean;
  compact?: boolean;
  umami: string;
}) {
  return (
    <FieldShell
      id={id}
      label="دسته‌بندی مادر"
      error={error}
      hint={hint}
      hideLabel={hideLabel}
      className={compact ? 'mt-2 min-w-32' : undefined}
    >
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        {...fieldAria(id, error, hint)}
        data-umami-event={umami}
        className={cn(
          controlClass(Boolean(error)),
          compact && COMPACT_CONTROL,
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        <option value="">بدون مادر (دسته‌بندی اصلی)</option>
        {parents.map((parent) => (
          <option key={parent.id} value={parent.id}>
            {parent.title}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
