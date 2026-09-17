'use client';

import { useId, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Filter, X } from 'lucide-react';
import {
  SHOP_PET_OPTIONS,
  buildShopHref,
  parseShopQuery,
  toggleShopCategory,
  toggleShopPet,
  updateShopQuery,
  type ShopQuery,
} from './shop-query';
import { PATHS } from '@/lib/constant/paths';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

export type ShopCategoryOption = {
  title: string;
  slug: string;
  /** `1` for a sub-category; the page orders them with `orderAsTree`. */
  depth: 0 | 1;
};

/**
 * The shop's filter panel: category, pet type and price range.
 *
 * Rendered twice — once in the desktop sidebar, once inside the mobile sheet
 * below — so every id is namespaced with `useId`; two `<input id="f-toys">` on
 * one page would point both labels at the first checkbox.
 *
 * Real `<input type="checkbox">` in a labelled `<fieldset>`, per the design
 * review (finding 3: the prototype's `div onClick` had no input element at
 * all). Native rather than a Radix checkbox on purpose — the platform control
 * already brings the keyboard, the announcement and the focus ring, and
 * `accent-color` is the whole styling gap.
 *
 * The panel holds no state of its own. Every change navigates to the URL that
 * describes the new filter set, and the next render reads it back — the URL is
 * the state, so a shared link and the back button cannot disagree with what is
 * on screen.
 *
 * The prototype's «برند» and «نیاز» groups are deliberately absent: the catalog
 * API has no parameters behind them, and a control that filters nothing is
 * worse than one that is missing (ledger finding 18).
 */
export function ShopFilters({
  query,
  categories,
  onApply,
}: {
  query: ShopQuery;
  categories: readonly ShopCategoryOption[];
  /** The sheet closes itself after a change; the sidebar passes nothing. */
  onApply?: () => void;
}) {
  const router = useRouter();
  const ids = useId();
  const [pending, startTransition] = useTransition();

  const go = (next: ShopQuery) => {
    startTransition(() => router.push(buildShopHref(next)));
    onApply?.();
  };

  const hasFilters =
    query.category !== undefined ||
    query.pet !== undefined ||
    query.minPrice !== undefined ||
    query.maxPrice !== undefined;

  return (
    <div
      // While a navigation is in flight the checkbox still shows the old URL's
      // state, because that is what is still on screen. Saying so beats
      // pretending the click did nothing.
      aria-busy={pending}
      className={cn('transition-opacity', pending && 'opacity-60')}
    >
      <fieldset className="mb-6">
        <legend className="text-muted-foreground mb-2 text-sm font-semibold">
          دسته‌بندی
        </legend>
        {/* A real list, not `div`s: the indent alone is visual, and a screen
            reader has to hear that a sub-category sits inside its parent.
            Exactly one box is ever ticked — the panel mirrors the single
            `?category=`, and a half-ticked parent would promise a multi-select
            the URL does not have. The parent's *results* include its children
            (that is the DAO's job); the control does not pretend to. */}
        <ul className="space-y-1">
          {categoryGroups(categories).map(({ parent, children }) => (
            <li key={parent.slug}>
              <CategoryBox
                category={parent}
                ids={ids}
                query={query}
                onToggle={go}
              />
              {children.length > 0 && (
                <ul className="ps-6">
                  {children.map((child) => (
                    <li key={child.slug}>
                      <CategoryBox
                        category={child}
                        ids={ids}
                        query={query}
                        onToggle={go}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset className="mb-6">
        <legend className="text-muted-foreground mb-2 text-sm font-semibold">
          نوع حیوان
        </legend>
        <div className="space-y-1">
          {SHOP_PET_OPTIONS.map((pet) => (
            <div key={pet.value} className="flex items-center gap-2.5 py-1.5">
              <input
                type="checkbox"
                id={`${ids}-pet-${pet.value}`}
                className="accent-accent-strong size-4 shrink-0 cursor-pointer"
                checked={query.pet === pet.value}
                onChange={() => go(toggleShopPet(query, pet.value))}
                data-umami-event="shop-filter-pet-toggle"
              />
              <label
                htmlFor={`${ids}-pet-${pet.value}`}
                className="cursor-pointer text-sm select-none"
              >
                {pet.label}
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <PriceFilter query={query} ids={ids} onSubmit={go} />

      {hasFilters && (
        <Link
          // A link to the canonical `/shop`, not a state reset: the URL is the
          // state, so clearing the filters *is* going to the unfiltered URL.
          href={PATHS.SHOP}
          className="text-accent-strong text-sm hover:underline"
          data-umami-event="shop-filter-clear"
          onClick={onApply}
        >
          پاک کردن فیلترها
        </Link>
      )}
    </div>
  );
}

/**
 * The flat, tree-ordered options as parents with their children. `orderAsTree`
 * has already put each sub-category straight after its parent, so one pass is
 * enough — no nested type travels from the page to here.
 */
function categoryGroups(categories: readonly ShopCategoryOption[]) {
  const groups: {
    parent: ShopCategoryOption;
    children: ShopCategoryOption[];
  }[] = [];
  for (const category of categories) {
    const last = groups.at(-1);
    if (category.depth === 1 && last) last.children.push(category);
    else groups.push({ parent: category, children: [] });
  }
  return groups;
}

/** One category checkbox, in the sidebar list or nested under its parent. */
function CategoryBox({
  category,
  ids,
  query,
  onToggle,
}: {
  category: ShopCategoryOption;
  ids: string;
  query: ShopQuery;
  onToggle: (next: ShopQuery) => void;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <input
        type="checkbox"
        id={`${ids}-category-${category.slug}`}
        className="accent-accent-strong size-4 shrink-0 cursor-pointer"
        checked={query.category === category.slug}
        onChange={() => onToggle(toggleShopCategory(query, category.slug))}
        // One event name for one behaviour, sub-categories included.
        data-umami-event="shop-filter-category-toggle"
      />
      <label
        htmlFor={`${ids}-category-${category.slug}`}
        className="cursor-pointer text-sm select-none"
      >
        {category.title}
      </label>
    </div>
  );
}

/**
 * The price range, which the prototype never had (ledger finding 18 left it to
 * porting time). Two integer-Toman bounds, applied on submit rather than on
 * every keystroke — a navigation per digit would be unusable.
 *
 * Entry is a plain number input, so the numeric keypad and the browser's own
 * validation apply; everything *rendered* — the applied range, the placeholder
 * — goes through `format.ts` and is therefore in Persian digits.
 */
function PriceFilter({
  query,
  ids,
  onSubmit,
}: {
  query: ShopQuery;
  ids: string;
  onSubmit: (next: ShopQuery) => void;
}) {
  return (
    <fieldset
      className="mb-6"
      // Remounts when the URL's bounds change (a cleared filter set, the back
      // button), so the uncontrolled inputs cannot keep showing a stale range.
      key={`${query.minPrice}-${query.maxPrice}`}
    >
      <legend className="text-muted-foreground mb-2 text-sm font-semibold">
        محدوده قیمت (تومان)
      </legend>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);

          // Validated by the same parser the URL goes through, so a bound typed
          // into the form and one pasted into the address bar cannot disagree.
          const { minPrice, maxPrice } = parseShopQuery({
            minPrice: String(data.get('minPrice') ?? ''),
            maxPrice: String(data.get('maxPrice') ?? ''),
          });

          onSubmit(updateShopQuery(query, { minPrice, maxPrice }));
        }}
      >
        <input
          type="number"
          inputMode="numeric"
          name="minPrice"
          min={0}
          step={1}
          id={`${ids}-min-price`}
          defaultValue={query.minPrice ?? ''}
          placeholder={formatNumber(0)}
          aria-label="حداقل قیمت به تومان"
          className="border-border bg-background nums focus-visible:border-accent-strong w-full min-w-0 rounded-xl border px-3 py-2 text-sm"
          data-umami-event="shop-filter-min-price"
        />
        <span className="text-muted-foreground text-sm" aria-hidden="true">
          تا
        </span>
        <input
          type="number"
          inputMode="numeric"
          name="maxPrice"
          min={1}
          step={1}
          id={`${ids}-max-price`}
          defaultValue={query.maxPrice ?? ''}
          placeholder={formatNumber(1_000_000)}
          aria-label="حداکثر قیمت به تومان"
          className="border-border bg-background nums focus-visible:border-accent-strong w-full min-w-0 rounded-xl border px-3 py-2 text-sm"
          data-umami-event="shop-filter-max-price"
        />
        <button
          type="submit"
          className="bg-secondary hover:bg-accent-strong shrink-0 rounded-xl px-3 py-2 text-sm font-semibold transition-colors hover:text-white"
          data-umami-event="shop-filter-price-apply"
        >
          اعمال
        </button>
      </form>
    </fieldset>
  );
}

/**
 * The same panel on mobile, in a bottom sheet.
 *
 * Native modal `<dialog>`, the house pattern from `mobile-menu.tsx` and
 * `cart-drawer.tsx` — read that file's comments before changing anything here,
 * in particular why closing always goes through `close()` and never
 * `dialog.close()` alone. The design review asked for a real sheet with a focus
 * trap and Escape (finding 3); the platform gives both, plus nothing focusable
 * while it is shut.
 */
export function ShopFilterSheet({
  query,
  categories,
  total,
}: {
  query: ShopQuery;
  categories: readonly ShopCategoryOption[];
  /** Shown on the confirm button, so the shopper knows before closing it. */
  total: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  const close = () => {
    dialogRef.current?.close();
    setOpen(false);
  };

  const activeCount = [
    query.category,
    query.pet,
    query.minPrice,
    query.maxPrice,
  ].filter((value) => value !== undefined).length;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          dialogRef.current?.showModal();
          setOpen(true);
        }}
        className="border-border hover:bg-secondary flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors lg:hidden"
        aria-expanded={open}
        data-umami-event="shop-filter-sheet-open"
      >
        <Filter size={14} aria-hidden="true" />
        فیلتر
        {activeCount > 0 && (
          <span className="nums">({formatNumber(activeCount)})</span>
        )}
      </button>

      <dialog
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
        }}
        onClose={() => setOpen(false)}
        // Target is the dialog itself → the click landed on the backdrop.
        onClick={(event) => {
          if (event.target === dialogRef.current) close();
        }}
        // Pinned to the bottom edge, undoing the UA's centred-box defaults.
        className="bg-background fixed inset-x-0 bottom-0 m-0 mt-auto max-h-[80vh] w-full max-w-none overflow-y-auto rounded-t-3xl border-0 p-0 shadow-lg backdrop:bg-black/50 lg:hidden"
        aria-label="فیلترها"
      >
        <div className="flex items-center justify-between border-b p-4">
          <p className="font-semibold">فیلترها</p>
          <button
            type="button"
            onClick={close}
            className="hover:bg-secondary flex size-10 items-center justify-center rounded-full transition-colors"
            aria-label="بستن فیلترها"
            data-umami-event="shop-filter-sheet-close"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="p-4">
          <ShopFilters
            query={query}
            categories={categories}
            // A filter change navigates and the results are behind the sheet,
            // so it gets out of the way rather than leaving the shopper to
            // dismiss it before seeing what they just did.
            onApply={close}
          />
          <button
            type="button"
            onClick={close}
            className="bg-accent-strong hover:bg-accent-hover w-full rounded-xl py-3.5 font-bold text-white transition-colors"
            data-umami-event="shop-filter-sheet-apply"
          >
            نمایش {formatNumber(total)} محصول
          </button>
        </div>
      </dialog>
    </>
  );
}
