'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, GripHorizontal, Plus, X } from 'lucide-react';
import { MAX_PRODUCT_IMAGES } from '@/lib/catalog/product-input';
import { toPersianDigits } from '@/lib/format';
import { ACCEPTED_IMAGE_TYPES } from '@/lib/storage/image-upload';
import { imageSrc } from '@/lib/storage/image-url';
import { validateImageFile } from '@/features/admin-panel/shared/image-picker';

// The product form's gallery field: up to `MAX_PRODUCT_IMAGES` photos as a grid
// of tiles the admin adds to, removes from and drags into order. The first tile
// is the cover — the shop card, the admin list thumbnail and the product page's
// opening image — so the order is the only thing that decides it and there is no
// `is_primary` anywhere.
//
// A sibling of `ImagePicker` rather than a `multiple` mode on it: that picker is
// shared with the storefront content editor, and a mode flag would fork its
// layout in two and leave the editor one regression away. What is shared is the
// part that must not drift — `validateImageFile`, the accept list and the format
// hint all come from that module, so the two Persian refusals are still said in
// one place.
//
// Reordering is hand-rolled on Pointer Events and no library. Native HTML5 drag
// and drop is out because it does not fire on touch, and a sortable library
// earns its ~13 kB on virtualized lists, nested containers and auto-scroll, none
// of which is six fixed cells in one grid. Five things make the hand-rolled
// version correct, and each is load-bearing:
//
//   · `touch-none` is on the HANDLE, never the tile — a finger landing anywhere
//     else on a tile must still scroll the admin form on a phone.
//   · The hit test runs against a snapshot of the SLOT rects taken on
//     `pointerdown`. The items move during a live reorder; the grid cells do
//     not, so the snapshot stays true for the whole gesture.
//   · `pointercancel` is handled exactly like `pointerup`. A missed cancel on
//     touch leaves a drag that can never be let go of.
//   · Tiles are keyed by photo identity, never by index. That is also what makes
//     the keyboard path work without any focus bookkeeping: React moves the same
//     DOM node, so the focused handle keeps its focus for free.
//   · The arrow mapping is hardcoded for RTL rather than probed from computed
//     style — the panel is `dir="rtl"` everywhere, and «right moves toward the
//     start» is a fact about this app, not about the element.

/** One tile's value: a photo already stored, or a file picked but not yet sent. */
export type ProductPhoto =
  | { id: string; kind: 'saved'; objectKey: string }
  | { id: string; kind: 'pending'; file: File; blobUrl: string };

const FIELD_LABEL = 'تصاویر محصول';
const FIELD_HINT = `عکس اول، عکس اصلی است و در فهرست فروشگاه و سبد خرید دیده می‌شود. حداکثر ${toPersianDigits(MAX_PRODUCT_IMAGES)} عکس.`;
const FORMAT_HINT = 'JPG، PNG یا WEBP، تا ۲ مگابایت';
const ADD_LABEL = 'افزودن عکس';
const COVER_CAPTION = 'عکس اصلی';
const EMPTY_STATE = 'هنوز عکسی اضافه نشده است.';
const DRAG_HINT =
  'برای جابه‌جایی، بکش و رها کن یا با کلیدهای جهت‌نما حرکت بده.';
const CAP_REACHED = `سقف ${toPersianDigits(MAX_PRODUCT_IMAGES)} عکس پر شده است؛ برای افزودن، یکی را حذف کن.`;

/** «عکس اصلی» for the cover, «۲»/«۳»/… for the rest — the caption and the name. */
const positionLabel = (index: number) =>
  index === 0 ? COVER_CAPTION : toPersianDigits(index + 1);

/** «عکس اصلی» / «عکس ۲» — how every control names the photo it acts on. */
const photoName = (index: number) =>
  index === 0 ? COVER_CAPTION : `عکس ${toPersianDigits(index + 1)}`;

const overPickMessage = (added: number) =>
  `فقط ${toPersianDigits(added)} عکس اول اضافه شد؛ سقف ${toPersianDigits(MAX_PRODUCT_IMAGES)} عکس است.`;

const rejectedMessage = (name: string, reason: string) =>
  `فایل «${name}» اضافه نشد: ${reason}`;

const addedMessage = (count: number) =>
  `${toPersianDigits(count)} عکس اضافه شد.`;

const movedMessage = (from: number, to: number) =>
  `${photoName(from)} به جایگاه ${toPersianDigits(to + 1)} منتقل شد` +
  (to === 0 ? `؛ حالا ${COVER_CAPTION} است.` : '.');

const removedMessage = (index: number) => `${photoName(index)} حذف شد.`;

/** The tile's preview source: a stored key resolved, or the pick's blob URL. */
const previewOf = (photo: ProductPhoto) =>
  photo.kind === 'saved' ? imageSrc(photo.objectKey) : photo.blobUrl;

/** `from` moved to `to`, the rest closing up behind it. */
const moved = <T,>(items: T[], from: number, to: number): T[] => {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

export function ProductImagesField({
  id,
  photos,
  onChange,
}: {
  id: string;
  photos: ProductPhoto[];
  onChange: (photos: ProductPhoto[]) => void;
}) {
  /** One line per file this field refused, cleared by the next pick. */
  const [rejections, setRejections] = useState<string[]>([]);
  /** The single polite line that reorder, add and remove all speak through. */
  const [announcement, setAnnouncement] = useState('');
  /** The tile being dragged, or null. Only its opacity depends on this. */
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const slotRefs = useRef<(HTMLLIElement | null)[]>([]);
  /** The cell rectangles as they were when the gesture started. */
  const slotRects = useRef<DOMRect[]>([]);

  // Revoking on unmount as well as on removal: without this the form leaks one
  // blob per pick for the life of the tab, which the single-slot picker did.
  // A ref, not the `photos` prop, because the cleanup must see the list as it
  // is at unmount and must not run on every change.
  const pendingUrls = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const photo of photos) {
      if (photo.kind === 'pending') pendingUrls.current.add(photo.blobUrl);
    }
  });
  useEffect(() => {
    const urls = pendingUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const atCap = photos.length >= MAX_PRODUCT_IMAGES;

  const addFiles = (chosen: File[]) => {
    const refused: string[] = [];
    const accepted: ProductPhoto[] = [];
    for (const file of chosen) {
      const invalid = validateImageFile(file);
      if (invalid) {
        refused.push(rejectedMessage(file.name, invalid));
        continue;
      }
      accepted.push({
        id: crypto.randomUUID(),
        kind: 'pending',
        file,
        blobUrl: URL.createObjectURL(file),
      });
    }

    // An over-cap pick takes the first N that fit and says so; the ones that do
    // not fit have their blob revoked right away rather than at unmount.
    const room = MAX_PRODUCT_IMAGES - photos.length;
    const taken = accepted.slice(0, Math.max(room, 0));
    for (const dropped of accepted.slice(taken.length)) {
      if (dropped.kind === 'pending') URL.revokeObjectURL(dropped.blobUrl);
    }
    if (taken.length < accepted.length) {
      refused.push(overPickMessage(taken.length));
    }

    setRejections(refused);
    if (taken.length === 0) return;
    onChange([...photos, ...taken]);
    setAnnouncement(addedMessage(taken.length));
  };

  const removeAt = (index: number) => {
    const photo = photos[index];
    if (photo.kind === 'pending') {
      URL.revokeObjectURL(photo.blobUrl);
      pendingUrls.current.delete(photo.blobUrl);
    }
    onChange(photos.filter((_, position) => position !== index));
    setAnnouncement(removedMessage(index));
  };

  /** Move a tile and say where it landed. Out-of-range targets are no-ops. */
  const moveTo = (from: number, to: number) => {
    if (to < 0 || to >= photos.length || to === from) return;
    onChange(moved(photos, from, to));
    setAnnouncement(movedMessage(from, to));
  };

  const onHandleKeyDown = (event: React.KeyboardEvent, index: number) => {
    // RTL, hardcoded: right is toward the start of the list, left toward its
    // end. Up/down keep their usual meaning. The arrows move the photo
    // directly — there is no pick-up/drop mode, so a reorder cannot be left
    // half-finished by a lost keystroke.
    const delta = { ArrowRight: -1, ArrowUp: -1, ArrowLeft: 1, ArrowDown: 1 }[
      event.key
    ];
    if (delta === undefined) return;
    event.preventDefault();
    moveTo(index, index + delta);
  };

  const onHandlePointerDown = (event: React.PointerEvent, index: number) => {
    // Left button or a touch/pen contact only — a right-click must not start a
    // drag that then has no pointerup to end it.
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    slotRects.current = slotRefs.current
      .slice(0, photos.length)
      .map((slot) => slot?.getBoundingClientRect())
      .filter((rect): rect is DOMRect => rect !== undefined);
    setDraggingId(photos[index].id);
  };

  const onHandlePointerMove = (event: React.PointerEvent, index: number) => {
    if (draggingId === null) return;
    const target = slotRects.current.findIndex(
      (rect) =>
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom,
    );
    // Outside every cell, or over the add tile past the last photo: nothing to
    // swap with, so the drag simply waits.
    if (target === -1 || target === index) return;
    moveTo(index, Math.min(target, photos.length - 1));
  };

  /** `pointerup` and `pointercancel` end a drag the same way — see the header. */
  const endDrag = (event: React.PointerEvent) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingId(null);
  };

  const hintId = `${id}-hint`;
  const dragHintId = `${id}-drag-hint`;
  const errorId = `${id}-error`;

  return (
    <div>
      <p id={id} className="mb-1.5 block text-sm font-medium">
        {FIELD_LABEL}
      </p>

      <ul
        className="grid grid-cols-3 gap-3 sm:grid-cols-6"
        aria-labelledby={id}
      >
        {photos.map((photo, index) => (
          <li
            key={photo.id}
            ref={(slot) => {
              slotRefs.current[index] = slot;
            }}
          >
            <div
              className={`bg-secondary relative aspect-square overflow-hidden rounded-xl ${
                index === 0 ? 'ring-accent-strong ring-2 ring-offset-2' : ''
              } ${photo.id === draggingId ? 'opacity-60' : ''}`}
            >
              <Image
                src={previewOf(photo)}
                alt=""
                fill
                sizes="110px"
                className="object-cover"
                unoptimized={photo.kind === 'pending'}
              />
              <button
                type="button"
                onClick={() => removeAt(index)}
                aria-label={`حذف ${photoName(index)}`}
                // 44px hit area around a 28px visible circle: the target clears
                // the touch floor without the circle swallowing a 90px tile.
                className="absolute end-0 top-0 flex size-11 items-center justify-center"
                data-umami-event="admin-panel-product-image-remove"
              >
                <span className="bg-ink/70 flex size-7 items-center justify-center rounded-full text-white">
                  <X size={14} aria-hidden="true" />
                </span>
              </button>
            </div>
            {/* One element is the drag handle, the position indicator and the
                cover indicator at once: no corner badge fighting the remove
                button on a 90px tile, a 44px touch target, and the thing that
                visibly changes on a drag is the thing the admin was already
                looking at. */}
            <button
              type="button"
              onKeyDown={(event) => onHandleKeyDown(event, index)}
              onPointerDown={(event) => onHandlePointerDown(event, index)}
              onPointerMove={(event) => onHandlePointerMove(event, index)}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              aria-label={`جابه‌جایی ${photoName(index)}`}
              aria-describedby={dragHintId}
              className={`mt-1 flex h-11 w-full cursor-grab touch-none items-center justify-center gap-1 rounded-lg text-xs ${
                index === 0
                  ? 'text-accent-strong font-medium'
                  : 'text-muted-foreground'
              }`}
              data-umami-event="admin-panel-product-image-reorder"
            >
              <GripHorizontal size={14} aria-hidden="true" />
              {positionLabel(index)}
            </button>
          </li>
        ))}

        {/* At the cap the add tile is not rendered at all and the hint below
            says why — the `atExtraCategoryCap` pattern from the same form. */}
        {!atCap && (
          <li>
            <label
              className="border-border hover:bg-secondary text-muted-foreground has-[:focus-visible]:outline-ring flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed text-xs transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2"
              data-umami-event="admin-panel-product-image-add"
            >
              <Plus size={18} aria-hidden="true" />
              {ADD_LABEL}
              <input
                type="file"
                multiple
                accept={ACCEPTED_IMAGE_TYPES.join(',')}
                className="sr-only"
                aria-describedby={
                  rejections.length > 0 ? `${hintId} ${errorId}` : hintId
                }
                aria-invalid={rejections.length > 0 || undefined}
                onChange={(event) => {
                  addFiles([...(event.target.files ?? [])]);
                  // Cleared so picking the same file twice in a row still
                  // fires a change event.
                  event.target.value = '';
                }}
              />
            </label>
          </li>
        )}
      </ul>

      {photos.length === 0 && (
        <p className="text-muted-foreground mt-2 text-xs">{EMPTY_STATE}</p>
      )}

      <p id={hintId} className="text-muted-foreground mt-2 text-xs">
        {atCap ? CAP_REACHED : FIELD_HINT} {FORMAT_HINT}
      </p>
      <p id={dragHintId} className="sr-only">
        {DRAG_HINT}
      </p>

      {rejections.length > 0 && (
        <div id={errorId}>
          {rejections.map((message) => (
            <p
              key={message}
              className="text-destructive mt-1.5 flex items-center gap-1 text-xs"
            >
              <AlertCircle size={12} aria-hidden="true" /> {message}
            </p>
          ))}
        </div>
      )}

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
