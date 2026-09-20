'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, GripHorizontal, Plus, X } from 'lucide-react';
import { MAX_PRODUCT_IMAGES } from '@/lib/catalog/product-input';
import { toPersianDigits } from '@/lib/format';
import {
  ACCEPTED_IMAGE_TYPES,
  IMAGE_FORMAT_HINT,
} from '@/lib/storage/image-upload';
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
// part that must not drift is `validateImageFile`, so that the two Persian
// refusals live in one place. The accept list and the format hint come
// straight from `@/lib/storage/image-upload`, which owns the cap they
// describe — an earlier version of this comment claimed all three were
// shared while the hint was a retyped copy promising a ceiling the route
// no longer enforced.

/** One tile's value: a photo already stored, or a file picked but not yet sent. */
export type ProductPhoto =
  | { id: string; kind: 'saved'; objectKey: string }
  | { id: string; kind: 'pending'; file: File; blobUrl: string };

const FIELD_LABEL = 'تصاویر محصول';
const FIELD_HINT = `عکس اول، عکس اصلی است و در فهرست فروشگاه و سبد خرید دیده می‌شود. حداکثر ${toPersianDigits(MAX_PRODUCT_IMAGES)} عکس.`;
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
  /**
   * The single polite line that reorder, add and remove all speak through.
   *
   * The counter is load-bearing, not bookkeeping: a live region announces only
   * when its text *changes*, and every message here is a pure function of an
   * index — removing the second photo twice produces the identical sentence,
   * so the second removal reached nobody. The seq is rendered as a trailing
   * run of non-breaking spaces, which screen readers swallow and which makes a
   * repeat a different string.
   */
  const [announcement, setAnnouncement] = useState({ text: '', seq: 0 });
  /** The tile being dragged, or null. Only its opacity depends on this. */
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const slotRefs = useRef<(HTMLLIElement | null)[]>([]);
  /**
   * The gesture in flight, or null. Held in a ref rather than state because the
   * window listeners below read it, and because nothing renders from it.
   */
  const dragging = useRef<{ pointerId: number; photoId: string } | null>(null);
  /** Aborts the window listeners that carry the gesture. */
  const dragListeners = useRef<AbortController | null>(null);
  /**
   * `photos` and `onChange` as of the last render, for the window listeners —
   * they are registered once per gesture and would otherwise reorder a list
   * they captured at `pointerdown`.
   */
  const latest = useRef({ photos, onChange });
  // Written in an effect rather than during render: an effect commits before
  // any pointer event can arrive, and writing a ref while rendering is exactly
  // the thing `react-hooks/refs` refuses.
  useEffect(() => {
    latest.current = { photos, onChange };
  });
  /** The add tile's input, the fallback when the last photo is removed. */
  const addRef = useRef<HTMLInputElement | null>(null);
  /**
   * The tile index focus is owed after a removal, or null. Set by `removeAt`
   * and spent by the effect below: the button that had focus unmounts with its
   * tile, and a browser drops focus to `<body>` when that happens — which ends
   * a keyboard admin's traversal at the top of the document with no
   * announcement of what became of it.
   */
  const focusAfterRemoval = useRef<number | null>(null);
  /**
   * The tile index whose handle focus is owed after a keyboard move. Same
   * hazard as `focusAfterRemoval` and the same cure: React reorders a keyed
   * list with `insertBefore`, and moving the element that holds focus drops
   * `document.activeElement` to `<body>`. `react-dom` does not use the
   * `moveBefore` that would preserve it. The two directions were not even
   * symmetric — `from < to` moves the dragged tile, `from > to` the displaced
   * one — so arrowing one way kept focus and the other way lost it.
   */
  const focusHandleAt = useRef<number | null>(null);

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
    if (taken.length > 0) onChange([...photos, ...taken]);
    // The refusals ride the live region too, not just the red lines. Those are
    // wired through the file input's `aria-describedby`, which is read when
    // focus lands on the input — and the pick that fills the last slot takes
    // the add tile, input and all, off the page, leaving nothing to describe.
    announce(
      [taken.length > 0 ? addedMessage(taken.length) : '', ...refused]
        .filter(Boolean)
        .join(' '),
    );
  };

  // After the render that drops the tile: put focus on the tile that took its
  // place, or on the new last tile when the removed one was at the end, or on
  // the add control when nothing is left — the only thing still on screen that
  // does anything. Runs on `photos` because that is the render it has to follow.
  useEffect(() => {
    const index = focusAfterRemoval.current;
    if (index === null) return;
    focusAfterRemoval.current = null;

    const slot = slotRefs.current[index] ?? slotRefs.current[photos.length - 1];
    const target =
      slot?.querySelector<HTMLButtonElement>('[data-photo-remove]') ??
      addRef.current;
    target?.focus();
  }, [photos]);

  // The keyboard twin of the effect above. `insertBefore` moves the focused
  // handle, which drops focus to `<body>`, so the handle that was operated has
  // to be given focus again at its new position.
  useEffect(() => {
    const index = focusHandleAt.current;
    if (index === null) return;
    focusHandleAt.current = null;
    slotRefs.current[index]
      ?.querySelector<HTMLButtonElement>('[data-photo-handle]')
      ?.focus();
  }, [photos]);

  // A gesture in flight when the field unmounts would leave its window
  // listeners behind.
  useEffect(() => () => dragListeners.current?.abort(), []);

  const removeAt = (index: number) => {
    const photo = photos[index];
    if (photo.kind === 'pending') {
      URL.revokeObjectURL(photo.blobUrl);
      pendingUrls.current.delete(photo.blobUrl);
    }
    onChange(photos.filter((_, position) => position !== index));
    announce(removedMessage(index));
    focusAfterRemoval.current = index;
  };

  const announce = (text: string) =>
    setAnnouncement((previous) => ({ text, seq: previous.seq + 1 }));

  /**
   * Move a tile and say where it landed. Out-of-range targets are no-ops.
   * Returns whether anything moved, so a keyboard caller knows whether focus
   * is owed somewhere new.
   *
   * Reads the list from `latest` rather than the closure: a window listener
   * registered at `pointerdown` would otherwise reorder the list as it was
   * when the finger went down.
   */
  const moveTo = (from: number, to: number): boolean => {
    const { photos: current, onChange: notify } = latest.current;
    if (to < 0 || to >= current.length || to === from) return false;
    notify(moved(current, from, to));
    announce(movedMessage(from, to));
    return true;
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
    // Focus follows the photo, not the position: the button this event came
    // from is about to be moved by `insertBefore`, which drops focus to
    // `<body>`. Only owed when something actually moved.
    if (moveTo(index, index + delta)) focusHandleAt.current = index + delta;
  };

  /**
   * End the gesture. Takes no event: it is called from window listeners, and
   * whatever ended it, the drag is over.
   */
  const endDrag = () => {
    dragListeners.current?.abort();
    dragListeners.current = null;
    dragging.current = null;
    setDraggingId(null);
  };

  /**
   * The gesture runs on `window`, and pointer capture is not what carries it.
   *
   * React reorders a keyed list with `insertBefore`. Moving the `<li>` that
   * holds the captured element silently drops the capture and fires **neither
   * `pointerup` nor `pointercancel`** — only `lostpointercapture`, on an
   * element that is mid-move. A handle-bound gesture therefore died after a
   * single cell in the one direction that moves the dragged tile
   * (`from < to`), and `draggingId` stayed set so the tile kept its drag
   * opacity for good. The other direction moves the *displaced* tile and
   * happened to work — which is the direction the E2E spec dragged, and why
   * every gate was green.
   *
   * Window listeners are immune, being nowhere near the node that moves.
   * Capture is still requested: it keeps the gesture out of other elements'
   * hover and selection behaviour while it lasts. Nothing depends on it
   * surviving.
   */
  const onHandlePointerDown = (event: React.PointerEvent, index: number) => {
    // Left button or a touch/pen contact only — a right-click must not start a
    // drag that then has no pointerup to end it.
    if (event.button !== 0) return;
    // A second finger while one is already dragging would otherwise start a
    // competing gesture that either release then ends.
    if (dragging.current !== null) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = {
      pointerId: event.pointerId,
      photoId: photos[index].id,
    };
    setDraggingId(photos[index].id);

    const controller = new AbortController();
    dragListeners.current = controller;
    const { signal } = controller;
    window.addEventListener('pointermove', onWindowPointerMove, { signal });
    window.addEventListener('pointerup', endDrag, { signal });
    window.addEventListener('pointercancel', endDrag, { signal });
  };

  const onWindowPointerMove = (event: PointerEvent) => {
    const drag = dragging.current;
    // Only the contact that started it: a second finger reports its own moves
    // to this same window listener.
    if (!drag || event.pointerId !== drag.pointerId) return;

    const current = latest.current.photos;
    // By id, never by the index the gesture started at — the list has been
    // reordering underneath the finger the whole time.
    const from = current.findIndex((photo) => photo.id === drag.photoId);
    if (from === -1) return;

    // Read per move rather than snapshotted at `pointerdown`: a snapshot is
    // viewport-relative, so a mid-drag scroll or an `sm:` breakpoint change
    // left every stored rect describing a cell that had moved. Six cells is a
    // trivial read. A `null` keeps its index here — compacting the array with
    // `filter` shifted every later rect one tile along.
    const rects = slotRefs.current
      .slice(0, current.length)
      .map((slot) => slot?.getBoundingClientRect() ?? null);
    const target = rects.findIndex(
      (rect) =>
        rect !== null &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom,
    );
    // Outside every cell, or already there: nothing to swap with, so the drag
    // waits. `findIndex` over this array cannot exceed the list, so the old
    // clamp had nothing to clamp.
    if (target === -1 || target === from) return;
    moveTo(from, target);
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
                data-photo-remove=""
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
              aria-label={`جابه‌جایی ${photoName(index)}`}
              // Focus management finds this button by its own attribute, never
              // by `data-umami-event`: those names are the E2E selectors, so
              // renaming one would silently become a focus change too.
              data-photo-handle=""
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
                ref={addRef}
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
        {atCap ? CAP_REACHED : FIELD_HINT} {IMAGE_FORMAT_HINT}
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
        {/* The trailing run makes a repeated sentence a different string, which
            is what a live region needs in order to speak at all. Constructed
            from an escape rather than typed, per the repo's rule on invisible
            characters, and alternating rather than growing. */}
        {announcement.text}
        {'\u00A0'.repeat(announcement.seq % 2)}
      </p>
    </div>
  );
}
