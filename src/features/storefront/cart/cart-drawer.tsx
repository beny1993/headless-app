'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import Link from 'next/link';
import { Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { subscribeToCartDrawer } from './drawer-open';
import {
  MAX_LINE_QTY,
  cartCount,
  cartTotal,
  getCart,
  getServerCart,
  lineTotal,
  removeFromCart,
  setLineQty,
  subscribe,
  type CartLine,
} from './cart';
import { PATHS } from '@/lib/constant/paths';
import { formatNumber, formatToman } from '@/lib/format';
import { imageSrc } from '@/lib/storage/image-url';
import { cn } from '@/lib/utils';

/**
 * The navbar's cart button, its badge, and the drawer they open — one
 * component, because the badge and the panel render the same cart and the
 * button owns whether the panel is open.
 *
 * Built on a native modal `<dialog>`, the house pattern from `mobile-menu.tsx`:
 * the platform gives the focus trap, Escape, background inertness, top-layer
 * stacking and nothing focusable while closed, with no overlay dependency.
 * Read that file's comments before changing anything here — in particular why
 * closing always goes through `close()` and never `dialog.close()` alone.
 *
 * The scroll lock is `body:has(dialog[open])` in globals.css.
 */
export function CartDrawer({ className }: { className?: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  // The server has no cart, so the first paint is a hidden badge and the real
  // one arrives on the render right after hydration. `getServerCart` is a
  // separate function on purpose — see its comment.
  const lines = useSyncExternalStore(subscribe, getCart, getServerCart);
  const count = cartCount(lines);

  // The DOM call and the `open` mirror that drives aria-expanded must move
  // together; the dialog's own `close` event is not dependable (see
  // mobile-menu.tsx — measured not to fire at all in Chromium here).
  const close = () => {
    dialogRef.current?.close();
    setOpen(false);
  };

  // Both halves, always — the DOM call and the `open` mirror — for the same
  // reason `close` does them together. Stable identity so the subscription
  // below is set up once rather than on every cart change.
  const show = useCallback(() => {
    // `showModal()` on an already-open dialog throws InvalidStateError, and
    // that is reachable: adding to the cart while the drawer is open.
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    setOpen(true);
  }, []);

  // Opening from elsewhere on the site — the product page's add button, which
  // is in a different branch of the tree entirely. See ./drawer-open.ts for
  // why that is a listener and not a context or a window global.
  useEffect(() => subscribeToCartDrawer(show), [show]);

  return (
    <>
      <button
        type="button"
        onClick={show}
        className={cn('relative', className)}
        aria-label={`سبد خرید (${formatNumber(count)} کالا)`}
        aria-expanded={open}
        data-umami-event="nav-cart-open"
      >
        <ShoppingBag size={18} aria-hidden="true" />
        {count > 0 && (
          <span
            className="bg-accent-strong nums absolute end-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
            aria-hidden="true"
          >
            {formatNumber(count)}
          </span>
        )}
      </button>

      <dialog
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
        }}
        onClose={() => setOpen(false)}
        // Target is the dialog itself → the click landed on the backdrop. Only
        // reliable because the panel below is `h-full`.
        onClick={(event) => {
          if (event.target === dialogRef.current) close();
        }}
        // Pinned to the start edge — the right, in RTL — full height, undoing
        // the UA's centred-box defaults. Logical `start-0` keeps it correct in
        // both directions.
        className="bg-background fixed inset-y-0 start-0 m-0 h-full max-h-none w-full max-w-none border-0 p-0 shadow-lg backdrop:bg-black/50 sm:w-120"
        aria-label="سبد خرید"
      >
        <div className="flex h-full flex-col">
          <div className="border-border flex items-center justify-between border-b p-5">
            <p className="text-foreground text-lg font-semibold">
              سبد خرید (<span className="nums">{formatNumber(count)}</span>)
            </p>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={close}
              className="hover:bg-secondary flex size-10 items-center justify-center rounded-full transition-colors"
              aria-label="بستن سبد خرید"
              data-umami-event="nav-cart-close"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          {lines.length === 0 ? (
            <EmptyCart onNavigate={close} />
          ) : (
            <>
              <div className="flex-1 space-y-4 overflow-y-auto p-5">
                {lines.map((line) => (
                  <CartLineRow
                    key={line.productId}
                    line={line}
                    // A removed row takes the button that was clicked with it,
                    // and the browser parks focus on <body> — outside the
                    // dialog, where Tab restarts from the top and the Escape
                    // handler below no longer receives the keydown. Hand focus
                    // to the one control that is always here.
                    onRemoved={() => closeButtonRef.current?.focus()}
                  />
                ))}
              </div>

              <div className="border-border space-y-4 border-t p-5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">جمع اقلام</span>
                  <span className="nums text-lg font-bold">
                    {formatToman(cartTotal(lines))}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">
                  هزینه ارسال در مرحله آدرس بر اساس استان محاسبه می‌شود.
                </p>
                <Link
                  href={PATHS.CHECKOUT}
                  // The drawer lives in the layout, so client navigation does
                  // not unmount it — without this the modal would sit on top
                  // of /checkout and block it.
                  onClick={close}
                  className="bg-accent-strong hover:bg-accent-hover block w-full rounded-xl py-3.5 text-center font-bold text-white transition-colors"
                  data-umami-event="cart-checkout-click"
                >
                  تکمیل خرید
                </Link>
                <button
                  type="button"
                  onClick={close}
                  className="hover:bg-secondary w-full rounded-xl py-3 text-sm font-semibold transition-colors"
                  data-umami-event="cart-continue-shopping"
                >
                  بازگشت به فروشگاه
                </button>
              </div>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}

function EmptyCart({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-5 text-center">
      <ShoppingBag
        size={48}
        className="text-muted-foreground"
        aria-hidden="true"
      />
      <p className="font-semibold">سبد خرید شما خالی است</p>
      <p className="text-muted-foreground text-sm">
        هنوز چیزی اضافه نکرده‌اید — از فروشگاه شروع کنید.
      </p>
      <Link
        href={PATHS.SHOP}
        onClick={onNavigate}
        className="bg-accent-strong hover:bg-accent-hover rounded-xl px-6 py-3 font-bold text-white transition-colors"
        data-umami-event="cart-empty-shop-click"
      >
        مشاهده محصولات
      </Link>
    </div>
  );
}

function CartLineRow({
  line,
  onRemoved,
}: {
  line: CartLine;
  onRemoved: () => void;
}) {
  const atMax = line.qty >= MAX_LINE_QTY;

  return (
    <div className="bg-secondary/50 flex gap-3 rounded-xl p-3 sm:gap-4 sm:p-4">
      {line.imageKey ? (
        // `alt=""`: the title is announced immediately after, so a described
        // thumbnail would only repeat it. `imageKey` is a storage key —
        // `imageSrc` resolves bundled `products/…` from public/, an `uploads/…`
        // object from the bucket.
        <img
          src={imageSrc(line.imageKey)}
          alt=""
          width={96}
          height={96}
          className="bg-muted size-20 rounded-lg object-cover sm:size-24"
        />
      ) : (
        <div className="bg-muted flex size-20 items-center justify-center rounded-lg sm:size-24">
          <ShoppingBag
            size={24}
            className="text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      )}

      <div className="min-w-0 flex-1">
        {line.brand && (
          <p className="text-muted-foreground text-sm">{line.brand}</p>
        )}
        <p className="line-clamp-2 text-base leading-snug font-semibold sm:text-lg">
          {line.title}
        </p>
        <p className="nums mt-1 text-base font-bold sm:text-lg">
          {formatToman(lineTotal(line))}
        </p>
        {line.qty > 1 && (
          <p className="nums text-muted-foreground text-sm">
            {formatNumber(line.qty)} × {formatToman(line.unitPrice)}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            removeFromCart(line.productId);
            onRemoved();
          }}
          // `min-h-11` is the 44px hit area, spent as padding around a label
          // that is only ~18px tall. `inline-flex` keeps the target on the
          // words instead of spanning the whole text column, where it would
          // sit one stray tap under the price.
          className="text-destructive -ms-2 mt-1 inline-flex min-h-11 items-center gap-1.5 px-2 text-sm hover:underline"
          aria-label={`حذف ${line.title} از سبد خرید`}
          data-umami-event="cart-line-remove"
        >
          <Trash2 size={16} aria-hidden="true" /> حذف
        </button>
      </div>

      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={() => {
            if (!atMax) setLineQty(line.productId, line.qty + 1);
          }}
          // `aria-disabled`, not `disabled`: the cap is reached by pressing
          // this very button, and a `disabled` attribute lands on the element
          // that currently has focus — the browser then drops focus to <body>,
          // outside the dialog. Announced the same, still focusable, inert
          // through the guard above.
          aria-disabled={atMax}
          className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-full transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
          aria-label={`افزایش تعداد ${line.title}`}
          data-umami-event="cart-line-increase"
        >
          <Plus size={14} aria-hidden="true" />
        </button>
        <span className="nums text-sm font-medium" aria-live="polite">
          {formatNumber(line.qty)}
        </span>
        <button
          type="button"
          // At one this removes the line, which is the design's behaviour —
          // the «حذف» button above is the discoverable way to do the same.
          // Removing takes this button with it, so focus has to be handed on.
          onClick={() => {
            setLineQty(line.productId, line.qty - 1);
            if (line.qty <= 1) onRemoved();
          }}
          className="border-border hover:bg-secondary flex size-10 items-center justify-center rounded-full border transition-colors"
          aria-label={`کاهش تعداد ${line.title}`}
          data-umami-event="cart-line-decrease"
        >
          <Minus size={14} aria-hidden="true" />
        </button>
        {atMax && (
          <span className="text-muted-foreground text-center text-[10px] leading-tight">
            حداکثر تعداد
          </span>
        )}
      </div>
    </div>
  );
}
