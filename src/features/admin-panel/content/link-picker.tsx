'use client';

import { AlertCircle } from 'lucide-react';
import { PET_TYPES, type PetType } from '@/lib/catalog/product-query';
import {
  LINK_PAGES,
  LINK_TYPES,
  resolveLink,
  type Link,
  type LinkPage,
  type LinkTargets,
  type LinkType,
} from '@/lib/content/link';
import { MAX_ROUTINE_CATEGORIES } from '@/lib/content/site-content';

/** A category or active product a destination can point at. */
export type LinkOption = { id: string; title: string; slug: string };
export type LinkOptions = { categories: LinkOption[]; products: LinkOption[] };

/** The pickers' Persian control names — exported so tests find controls by name. */
export const LINK_PICKER_LABELS = {
  type: 'نوع مقصد',
  page: 'صفحه',
  category: 'دسته‌بندی',
  pet: 'حیوان',
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

const PET_LABELS: Record<PetType, string> = {
  [PET_TYPES.CAT]: 'گربه',
  [PET_TYPES.DOG]: 'سگ',
};

const MISSING_CATEGORY = 'دسته‌بندی حذف‌شده';
const MISSING_PRODUCT = 'محصول حذف‌شده یا غیرفعال';

const controlClass = (error: string | undefined) =>
  `bg-secondary h-12 w-full rounded-xl border px-4 text-sm outline-none ${
    error
      ? 'border-destructive'
      : 'border-border focus-visible:border-accent-strong'
  }`;

/** A shop link carrying only the filters actually chosen — an empty select is "all". */
const shopLink = (categoryId: string | undefined, pet: string): Link => ({
  type: LINK_TYPES.SHOP,
  ...(categoryId ? { categoryId } : {}),
  ...(pet ? { pet: pet as PetType } : {}),
});

function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p className="text-destructive mt-1.5 flex items-center gap-1 text-xs">
      <AlertCircle size={12} aria-hidden="true" /> {error}
    </p>
  );
}

/**
 * One link's destination: a type, then the one or two choices that type needs,
 * and a live «مقصد» preview of where the storefront will send it — the code
 * `fallback` while nothing is saved. Fully controlled (`value` / `onChange`): the
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
          className={controlClass(error)}
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
            className={controlClass(error)}
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
              onChange={(e) =>
                onChange(shopLink(e.target.value, value.pet ?? ''))
              }
              className={controlClass(error)}
              data-umami-event="admin-panel-content-link-category-change"
            >
              <option value="">همه دسته‌بندی‌ها</option>
              {value.categoryId &&
                !options.categories.some((c) => c.id === value.categoryId) && (
                  <option value={value.categoryId}>{MISSING_CATEGORY}</option>
                )}
              {options.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.title}
                </option>
              ))}
            </select>
            <select
              aria-label={LINK_PICKER_LABELS.pet}
              value={value.pet ?? ''}
              onChange={(e) =>
                onChange(shopLink(value.categoryId, e.target.value))
              }
              className={controlClass(error)}
              data-umami-event="admin-panel-content-link-pet-change"
            >
              <option value="">همه حیوانات</option>
              {Object.values(PET_TYPES).map((pet) => (
                <option key={pet} value={pet}>
                  {PET_LABELS[pet]}
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
            className={controlClass(error)}
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
            className={controlClass(error)}
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
      <FieldError error={error} />
    </div>
  );
}

/**
 * A routine tab's categories: up to `MAX_ROUTINE_CATEGORIES`, kept in the order
 * they were ticked — the order its tiles show. None ticked is `undefined`, so the
 * tab falls back to its code categories (`fallback`) instead of storing an empty
 * list the schema would refuse. A saved category deleted since stays listed,
 * ticked, so it can be removed.
 */
export function CategoryPicker({
  id,
  label,
  value,
  fallback,
  categories,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: readonly string[] | undefined;
  fallback: string;
  categories: LinkOption[];
  error?: string;
  onChange: (next: string[] | undefined) => void;
}) {
  const labelId = `${id}-label`;
  const selected = value ?? [];
  const shown = [
    ...categories,
    ...selected
      .filter((picked) => !categories.some((c) => c.id === picked))
      .map((picked) => ({ id: picked, title: MISSING_CATEGORY, slug: '' })),
  ];
  const titleOf = (picked: string) =>
    shown.find((category) => category.id === picked)?.title;

  const toggle = (categoryId: string, checked: boolean) => {
    const next = checked
      ? [...selected, categoryId]
      : selected.filter((picked) => picked !== categoryId);
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
                checked={checked}
                disabled={!checked && selected.length >= MAX_ROUTINE_CATEGORIES}
                onChange={(e) => toggle(category.id, e.target.checked)}
                data-umami-event="admin-panel-content-routine-category-toggle"
                className="size-4 shrink-0"
              />
              {category.title}
            </label>
          );
        })}
      </div>
      <p className="text-muted-foreground mt-1.5 text-xs">
        {selected.length > 0 ? (
          `به این ترتیب نمایش داده می‌شوند: ${selected.map(titleOf).join('، ')}`
        ) : (
          <>
            تا چهار دسته‌بندی، به ترتیب انتخاب. پیش‌فرض:{' '}
            <span dir="ltr" className="inline-block align-middle">
              {fallback}
            </span>
          </>
        )}
      </p>
      <FieldError error={error} />
    </div>
  );
}
