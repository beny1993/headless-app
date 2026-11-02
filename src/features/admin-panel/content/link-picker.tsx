'use client';

import { GripVertical } from 'lucide-react';
import {
  LINK_PAGES,
  LINK_TYPES,
  resolveLink,
  type Link,
  type LinkPage,
  type LinkTargets,
  type LinkType,
} from '@/lib/content/link';
import { FEATURED_COUNT } from '@/lib/content/site-content';
import { toPersianDigits } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DRAG_HINT, useDragReorder } from '@/hooks/use-drag-reorder';
import { controlClass, fieldAria, FieldMessage } from '@/components/ui/field';

/** A category or active product a destination can point at. */
export type LinkOption = {
  id: string;
  title: string;
  slug: string;
  /**
   * The indented form for a tree `<select>`, where «— شامپو و نظافت» is how a
   * sub-category shows it sits under its parent. Anywhere the option is not a
   * line in that list — a chip, a sentence naming what was picked — the
   * prefix is a dash with nothing on the other side of it, so those read
   * `title`. Absent for a flat list, where the two are the same thing.
   */
  label?: string;
};
export type LinkOptions = {
  categories: LinkOption[];
  /** The top-level categories in display order — the home strip's candidates. */
  mainCategories: LinkOption[];
  products: LinkOption[];
  /**
   * The products the shop lists as a card — family heads and standalone
   * products, never a member — for the «پیشنهادهای ما» boxes. A member
   * picked there would be dropped by the listing and its box silently refilled.
   */
  cards: LinkOption[];
};

/** The pickers' Persian control names — exported so tests find controls by name. */
export const LINK_PICKER_LABELS = {
  type: 'نوع مقصد',
  page: 'صفحه',
  category: 'دسته‌بندی',
  product: 'محصول',
  url: 'آدرس لینک',
} as const;

const TYPE_LABELS: Record<LinkType, string> = {
  [LINK_TYPES.PAGE]: 'صفحه سایت',
  [LINK_TYPES.SHOP]: 'فروشگاه',
  [LINK_TYPES.PRODUCT]: 'محصول',
  [LINK_TYPES.EXTERNAL]: 'لینک بیرونی',
};

const PAGE_LABELS: Record<LinkPage, string> = {
  home: 'خانه',
  shop: 'فروشگاه',
  about: 'درباره ما',
  account: 'حساب کاربری',
};

const MISSING_CATEGORY = 'دسته‌بندی حذف‌شده';
const MISSING_PRODUCT = 'محصول حذف‌شده یا غیرفعال';
/** A featured pick the shop no longer lists as a card — gone, hidden, or now a family member. */
const MISSING_CARD = 'محصول حذف‌شده، غیرفعال یا زیرمجموعه';
/**
 * A place the admin left to the storefront: a featured box nothing is picked
 * for, or a home tile the display order fills.
 */
const AUTO = 'خودکار';

/** A shop link carrying only the filters actually chosen — an empty select is "all". */
const shopLink = (categoryId: string | undefined): Link => ({
  type: LINK_TYPES.SHOP,
  ...(categoryId ? { categoryId } : {}),
});

/**
 * One link's destination: a type, then the one or two choices that type needs,
 * and a live «مقصد» preview of where the storefront will send it. While nothing
 * is saved it shows the built-in `fallback`, which the storefront widens to the
 * whole shop when the catalogue has no such category. Fully controlled (`value` / `onChange`): the
 * block form owns the state and saves it with the rest of the block. Unset is
 * `undefined`, never an empty link, so a cleared picker stores nothing.
 *
 * A saved category or product that no longer exists stays selected under a
 * «deleted» option, so the admin sees why a save is refused and can re-point it.
 */
export function LinkPicker({
  id,
  label,
  value,
  fallback,
  options,
  targets,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: Link | null | undefined;
  fallback: string;
  options: LinkOptions;
  targets: LinkTargets;
  error?: string;
  onChange: (next: Link | undefined) => void;
}) {
  const labelId = `${id}-label`;
  const preview = resolveLink(value, fallback, targets);

  const changeType = (type: string) => {
    if (type === LINK_TYPES.PAGE) {
      onChange({ type: LINK_TYPES.PAGE, page: LINK_PAGES[0] });
    } else if (type === LINK_TYPES.SHOP) {
      onChange({ type: LINK_TYPES.SHOP });
    } else if (type === LINK_TYPES.PRODUCT) {
      onChange({
        type: LINK_TYPES.PRODUCT,
        productId: options.products[0]?.id ?? '',
      });
    } else if (type === LINK_TYPES.EXTERNAL) {
      onChange({ type: LINK_TYPES.EXTERNAL, url: '' });
    } else {
      onChange(undefined);
    }
  };

  return (
    <div role="group" aria-labelledby={labelId}>
      <p id={labelId} className="mb-1.5 text-sm font-medium">
        {label}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <select
          aria-label={LINK_PICKER_LABELS.type}
          value={value?.type ?? ''}
          onChange={(e) => changeType(e.target.value)}
          {...fieldAria(id, error)}
          className={controlClass(Boolean(error))}
          data-umami-event="admin-panel-content-link-type-change"
        >
          <option value="">پیش‌فرض</option>
          {Object.values(LINK_TYPES).map((type) => (
            <option
              key={type}
              value={type}
              disabled={
                type === LINK_TYPES.PRODUCT && options.products.length === 0
              }
            >
              {TYPE_LABELS[type]}
            </option>
          ))}
        </select>

        {value?.type === LINK_TYPES.PAGE && (
          <select
            aria-label={LINK_PICKER_LABELS.page}
            value={value.page}
            onChange={(e) =>
              onChange({
                type: LINK_TYPES.PAGE,
                page: e.target.value as LinkPage,
              })
            }
            {...fieldAria(id, error)}
            className={controlClass(Boolean(error))}
            data-umami-event="admin-panel-content-link-page-change"
          >
            {LINK_PAGES.map((page) => (
              <option key={page} value={page}>
                {PAGE_LABELS[page]}
              </option>
            ))}
          </select>
        )}

        {value?.type === LINK_TYPES.SHOP && (
          <>
            <select
              aria-label={LINK_PICKER_LABELS.category}
              value={value.categoryId ?? ''}
              onChange={(e) => onChange(shopLink(e.target.value))}
              {...fieldAria(id, error)}
              className={controlClass(Boolean(error))}
              data-umami-event="admin-panel-content-link-category-change"
            >
              <option value="">همه دسته‌بندی‌ها</option>
              {value.categoryId &&
                !options.categories.some((c) => c.id === value.categoryId) && (
                  <option value={value.categoryId}>{MISSING_CATEGORY}</option>
                )}
              {options.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label ?? category.title}
                </option>
              ))}
            </select>
          </>
        )}

        {value?.type === LINK_TYPES.PRODUCT && (
          <select
            aria-label={LINK_PICKER_LABELS.product}
            value={value.productId}
            onChange={(e) =>
              onChange({ type: LINK_TYPES.PRODUCT, productId: e.target.value })
            }
            {...fieldAria(id, error)}
            className={controlClass(Boolean(error))}
            data-umami-event="admin-panel-content-link-product-change"
          >
            {!options.products.some((p) => p.id === value.productId) && (
              <option value={value.productId}>{MISSING_PRODUCT}</option>
            )}
            {options.products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.title}
              </option>
            ))}
          </select>
        )}

        {value?.type === LINK_TYPES.EXTERNAL && (
          <input
            type="url"
            inputMode="url"
            dir="ltr"
            aria-label={LINK_PICKER_LABELS.url}
            data-umami-event="admin-panel-content-link-url-input"
            placeholder="https://example.com"
            value={value.url}
            onChange={(e) =>
              onChange({ type: LINK_TYPES.EXTERNAL, url: e.target.value })
            }
            {...fieldAria(id, error)}
            className={controlClass(Boolean(error))}
          />
        )}
      </div>

      {/* LTR: a path or URL must not bidi-reorder inside the RTL shell. */}
      <p className="text-muted-foreground mt-1.5 text-xs">
        مقصد:{' '}
        <span dir="ltr" className="inline-block align-middle">
          {preview.href || '—'}
        </span>
        {preview.external && ' (در برگه جدید)'}
      </p>
      <FieldMessage id={id} error={error} />
    </div>
  );
}

/**
 * A section's picked categories — a routine tab's, or the home strip's — up to
 * `max`. Under the boxes, the picks form a numbered list in the order the
 * section shows them, each with a grip to drag it or arrow it into place
 * (`useDragReorder`, the product gallery's). What is saved is that list's
 * order; a newly ticked category joins at its end. None ticked is `undefined`,
 * so the section falls back to its code categories (`fallback`) instead of
 * storing an empty list the schema would refuse. A saved category deleted since
 * stays among the boxes, ticked, so it can be removed — but not in the list,
 * which shows only what the section will render.
 *
 * `shows` is for a section that fills the places left unticked (the home
 * strip): given the picks, every category it will show. Those filled places
 * follow the picks in the list, greyed and marked «خودکار», with no grip: they
 * are the display order's, not the admin's to move.
 */
export function CategoryPicker({
  id,
  label,
  value,
  fallback,
  categories,
  max,
  umami,
  shows,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: readonly string[] | undefined;
  fallback: string;
  categories: LinkOption[];
  /** How many may be ticked — the schema's own `.max()`. */
  max: number;
  /** The `data-umami-event` of every checkbox, and of every grip. */
  umami: { toggle: string; reorder: string };
  shows?: (picked: readonly string[]) => LinkOption[];
  error?: string;
  onChange: (next: string[] | undefined) => void;
}) {
  const labelId = `${id}-label`;
  const dragHintId = `${id}-drag-hint`;
  const selected = value ?? [];
  const missing = selected.filter(
    (picked) => !categories.some((c) => c.id === picked),
  );
  const shown = [
    ...categories,
    ...missing.map((picked) => ({
      id: picked,
      title: MISSING_CATEGORY,
      slug: '',
    })),
  ];
  // The rows that move: the picks the section can show, in the saved order.
  const picked = selected.flatMap((pick) =>
    categories.filter((category) => category.id === pick),
  );
  // The places the section fills behind them, by display order.
  const filled = shows
    ? shows(selected).filter((category) => !selected.includes(category.id))
    : [];

  const {
    slotRefs,
    draggingId,
    onHandleKeyDown,
    onHandlePointerDown,
    liveRegionProps,
  } = useDragReorder({
    items: picked,
    // A deleted pick rides along behind the list, still ticked: a reorder is
    // not the place to drop it from the save without the admin seeing.
    onChange: (next) =>
      onChange([...next.map((category) => category.id), ...missing]),
    movedMessage: (from, to) =>
      `${picked[from].title} به جایگاه ${toPersianDigits(to + 1)} منتقل شد.`,
    handleSelector: '[data-category-handle]',
  });

  const toggle = (categoryId: string, checked: boolean) => {
    const next = checked
      ? [...selected, categoryId]
      : selected.filter((pick) => pick !== categoryId);
    onChange(next.length > 0 ? next : undefined);
  };

  return (
    <div role="group" aria-labelledby={labelId}>
      <p id={labelId} className="mb-1.5 text-sm font-medium">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {shown.map((category) => {
          const checked = selected.includes(category.id);
          return (
            <label
              key={category.id}
              className="border-border flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                {...fieldAria(id, error)}
                checked={checked}
                disabled={!checked && selected.length >= max}
                onChange={(e) => toggle(category.id, e.target.checked)}
                data-umami-event={umami.toggle}
                className="size-4 shrink-0"
              />
              {category.title}
            </label>
          );
        })}
      </div>
      {shows ? (
        <p className="text-muted-foreground mt-1.5 text-xs">
          تا {toPersianDigits(max)} دسته‌بندی، به ترتیب فهرست زیر؛ جای خالی را
          بقیه به ترتیب نمایش پر می‌کنند.
        </p>
      ) : (
        selected.length === 0 && (
          <p className="text-muted-foreground mt-1.5 text-xs">
            تا {toPersianDigits(max)} دسته‌بندی. پیش‌فرض:{' '}
            <span dir="ltr" className="inline-block align-middle">
              {fallback}
            </span>
          </p>
        )
      )}
      {picked.length + filled.length > 0 && (
        <ol className="border-border mt-3 divide-y overflow-hidden rounded-xl border">
          {picked.map((category, index) => (
            <li
              key={category.id}
              ref={(slot) => {
                slotRefs.current[index] = slot;
              }}
              // The E2E spec's hook — asserting on the Tailwind class pins nothing.
              data-category-dragging={
                category.id === draggingId ? '' : undefined
              }
              className={cn(
                'flex items-center gap-3 ps-4 text-sm',
                category.id === draggingId && 'bg-secondary opacity-60',
              )}
            >
              <span className="text-muted-foreground w-4 shrink-0 text-center">
                {toPersianDigits(index + 1)}
              </span>
              <span className="min-w-0 flex-1 font-medium">
                {category.title}
              </span>
              {/* A 44px touch target, and `touch-none` so a finger on it drags
                  the row instead of scrolling the page. Focus management finds
                  it by its own attribute, never by the event name. */}
              <button
                type="button"
                onKeyDown={(event) => onHandleKeyDown(event, index)}
                onPointerDown={(event) => onHandlePointerDown(event, index)}
                aria-label={`جابه‌جایی ${category.title}`}
                aria-describedby={dragHintId}
                data-category-handle=""
                data-umami-event={umami.reorder}
                className="text-muted-foreground flex size-11 shrink-0 cursor-grab touch-none items-center justify-center"
              >
                <GripVertical size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
          {filled.map((category, index) => (
            <li
              key={category.id}
              // A slot to hit as well, so a pick dragged onto it stops at the
              // last pick's place instead of waiting where it was.
              ref={(slot) => {
                slotRefs.current[picked.length + index] = slot;
              }}
              className="bg-secondary/60 text-muted-foreground flex min-h-11 items-center gap-3 px-4 text-sm"
            >
              <span className="w-4 shrink-0 text-center">
                {toPersianDigits(picked.length + index + 1)}
              </span>
              <span className="min-w-0 flex-1">{category.title}</span>
              <span className="text-xs">{AUTO}</span>
            </li>
          ))}
        </ol>
      )}
      {/* Shown, not screen-reader-only as the gallery's is: a grip icon alone
          does not tell a sighted admin that the rows drag, and the order the
          section shows is this list's, whatever order the boxes were ticked. */}
      {picked.length > 0 && (
        <p id={dragHintId} className="text-muted-foreground mt-1.5 text-xs">
          {DRAG_HINT}
        </p>
      )}
      <p {...liveRegionProps} />
      <FieldMessage id={id} error={error} />
    </div>
  );
}

/**
 * The «پیشنهادهای ما» boxes: one select per card, in grid order, each holding
 * a product the shop lists as a card, or «خودکار» (`null`) — the storefront then
 * fills that box by the automatic rule (`fallback`). A product picked in one box
 * is disabled in the others. Every box on «خودکار» is `undefined`, never four
 * nulls, so a cleared picker stores nothing. A saved pick no longer offered —
 * gone, hidden, or since filed under a family — stays selected under an option
 * saying so, and the save check refuses it with the same reason, so the admin
 * sees why a save is refused and can re-point it.
 */
export function ProductPicker({
  id,
  label,
  value,
  fallback,
  products,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: readonly (string | null)[] | undefined;
  fallback: string;
  products: LinkOption[];
  error?: string;
  onChange: (next: (string | null)[] | undefined) => void;
}) {
  const labelId = `${id}-label`;
  const boxes = Array.from(
    { length: FEATURED_COUNT },
    (_, box) => value?.[box] ?? null,
  );

  const pick = (box: number, productId: string) => {
    const next = boxes.map((current, i) =>
      i === box ? productId || null : current,
    );
    onChange(next.some((picked) => picked !== null) ? next : undefined);
  };

  return (
    <div role="group" aria-labelledby={labelId}>
      <p id={labelId} className="mb-1.5 text-sm font-medium">
        {label}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {boxes.map((picked, box) => (
          <select
            key={box}
            aria-label={`کارت ${toPersianDigits(box + 1)}`}
            value={picked ?? ''}
            onChange={(e) => pick(box, e.target.value)}
            {...fieldAria(id, error)}
            className={controlClass(Boolean(error))}
            data-umami-event="admin-panel-content-featured-product-change"
          >
            <option value="">{AUTO}</option>
            {picked && !products.some((p) => p.id === picked) && (
              <option value={picked}>{MISSING_CARD}</option>
            )}
            {products.map((product) => (
              <option
                key={product.id}
                value={product.id}
                disabled={product.id !== picked && boxes.includes(product.id)}
              >
                {product.title}
              </option>
            ))}
          </select>
        ))}
      </div>
      <p className="text-muted-foreground mt-1.5 text-xs">
        کارتی که «{AUTO}» باشد، یا محصولش ناموجود شود، با پیشنهاد فروشگاه پر
        می‌شود: {fallback}.
      </p>
      <FieldMessage id={id} error={error} />
    </div>
  );
}
