'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Drag-to-reorder for a keyed list: a pointer gesture carried by `window`
// listeners, the arrow keys on each item's handle, focus following the handle
// that moved, and one polite live region saying where each move landed. The
// product gallery's photos and the content editor's category picks both run
// through it, so every trap documented below is fixed once, for both.
//
// The caller renders everything. Each item's slot registers in `slotRefs` at
// its index — and a fixed row after the list, like the home strip's «خودکار»
// tiles, at the indices after it, so a drag onto one stops at the last item.
// Each handle takes `onHandleKeyDown`/`onHandlePointerDown`, the item whose id
// is `draggingId` is marked, and `liveRegionProps` is spread on one `<p>` —
// the `dialogProps` pattern from `use-modal-dialog.ts`.

/** What every drag handle is described by: both ways to move it. */
export const DRAG_HINT =
  'برای جابه‌جایی، بکش و رها کن یا با کلیدهای جهت‌نما حرکت بده.';

/** `from` moved to `to`, the rest closing up behind it. */
const moved = <T>(items: readonly T[], from: number, to: number): T[] => {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

export function useDragReorder<T extends { id: string }>({
  items,
  onChange,
  movedMessage,
  handleSelector,
}: {
  items: readonly T[];
  onChange: (items: T[]) => void;
  /** What the live region says when the item at `from` lands at `to`. */
  movedMessage: (from: number, to: number) => string;
  /** Finds an item's handle inside its slot, to give it focus back after a keyboard move. */
  handleSelector: string;
}) {
  /**
   * The single polite line every move speaks through, and whatever else the
   * caller `announce`s — the gallery's adds and removes. `seq` is
   * load-bearing: a live region announces only when its text changes, so it
   * renders as trailing non-breaking spaces that make a repeat differ.
   */
  const [announcement, setAnnouncement] = useState({ text: '', seq: 0 });
  /** The item being dragged, or null. Only its marking depends on this. */
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const slotRefs = useRef<(HTMLElement | null)[]>([]);
  /** The gesture in flight, or null — read by the window listeners. */
  const dragging = useRef<{ pointerId: number; itemId: string } | null>(null);
  /** Aborts the window listeners that carry the gesture. */
  const dragListeners = useRef<AbortController | null>(null);
  /**
   * `items`, `onChange` and `movedMessage` as of the last render, for the
   * window listeners — they are registered once per gesture and would
   * otherwise reorder a list they captured at `pointerdown`.
   */
  const latest = useRef({ items, onChange, movedMessage });
  // A layout effect, not a passive one: a `pointermove` can land between the
  // commit and a passive effect, and read a stale list. Nothing interleaves a
  // layout effect.
  useLayoutEffect(() => {
    latest.current = { items, onChange, movedMessage };
  });
  /**
   * The index whose handle focus is owed after a keyboard move: React
   * reorders a keyed list with `insertBefore`, and moving the focused element
   * drops focus to `<body>` — in one direction only (`from < to`).
   */
  const focusHandleAt = useRef<number | null>(null);

  // After the render that moved the item: `insertBefore` moves the focused
  // handle, which drops focus to `<body>`, so the handle that was operated has
  // to be given focus again at its new position. Runs on `items` because that
  // is the render it has to follow.
  useLayoutEffect(() => {
    const index = focusHandleAt.current;
    if (index === null) return;
    focusHandleAt.current = null;
    slotRefs.current[index]
      ?.querySelector<HTMLElement>(handleSelector)
      ?.focus();
  }, [items, handleSelector]);

  // A gesture in flight when the list unmounts would leave its window
  // listeners behind.
  useEffect(() => () => dragListeners.current?.abort(), []);

  const announce = (text: string) =>
    setAnnouncement((previous) => ({ text, seq: previous.seq + 1 }));

  /**
   * Move an item and say where it landed. Out-of-range targets are no-ops.
   * Returns whether anything moved, so a keyboard caller knows whether focus
   * is owed somewhere new.
   *
   * Reads the list from `latest` rather than the closure: a window listener
   * registered at `pointerdown` would otherwise reorder the list as it was
   * when the finger went down.
   */
  const moveTo = (from: number, to: number): boolean => {
    const {
      items: current,
      onChange: notify,
      movedMessage: say,
    } = latest.current;
    if (to < 0 || to >= current.length || to === from) return false;
    notify(moved(current, from, to));
    announce(say(from, to));
    return true;
  };

  const onHandleKeyDown = (event: React.KeyboardEvent, index: number) => {
    // RTL, hardcoded: right is toward the start of the list, left toward its
    // end. Up/down keep their usual meaning. The arrows move the item
    // directly — there is no pick-up/drop mode, so a reorder cannot be left
    // half-finished by a lost keystroke.
    const delta = { ArrowRight: -1, ArrowUp: -1, ArrowLeft: 1, ArrowDown: 1 }[
      event.key
    ];
    if (delta === undefined) return;
    event.preventDefault();
    // Focus follows the item, not the position: the button this event came
    // from is about to be moved by `insertBefore`, which drops focus to
    // `<body>`. Only owed when something actually moved.
    if (moveTo(index, index + delta)) focusHandleAt.current = index + delta;
  };

  /**
   * End the gesture — only for the contact that started it: a foreign release
   * (a resting thumb, a stray tap) reaches these window listeners too. `blur`
   * passes no pointer and ends it unconditionally, so an alt-tab mid-drag
   * cannot leave the gesture running with no finger.
   */
  const endDrag = (event?: Event) => {
    const drag = dragging.current;
    if (
      drag &&
      event instanceof PointerEvent &&
      event.pointerId !== drag.pointerId
    ) {
      return;
    }
    dragListeners.current?.abort();
    dragListeners.current = null;
    dragging.current = null;
    setDraggingId(null);
  };

  /**
   * The gesture runs on `window`; pointer capture is not what carries it.
   * React reorders with `insertBefore`, and moving the `<li>` holding the
   * captured element drops the capture firing **neither `pointerup` nor
   * `pointercancel`** — so a handle-bound drag toward the end dies after one
   * cell. Capture is still requested; nothing depends on it.
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
      itemId: items[index].id,
    };
    setDraggingId(items[index].id);

    const controller = new AbortController();
    dragListeners.current = controller;
    const { signal } = controller;
    window.addEventListener('pointermove', onWindowPointerMove, { signal });
    window.addEventListener('pointerup', endDrag, { signal });
    window.addEventListener('pointercancel', endDrag, { signal });
    // Non-capturing, and that is load-bearing: `blur` does not bubble, so only
    // the window's own blur reaches this. Chrome focuses the handle on
    // pointerdown and the first reorder moves it, dropping focus to `<body>` —
    // a blur on every cell crossed. `focusout` or `capture: true` here would
    // end every drag after one cell.
    window.addEventListener('blur', endDrag, { signal });
  };

  const onWindowPointerMove = (event: PointerEvent) => {
    const drag = dragging.current;
    // Only the contact that started it: a second finger reports its own moves
    // to this same window listener.
    if (!drag || event.pointerId !== drag.pointerId) return;

    const current = latest.current.items;
    // By id, never by the index the gesture started at — the list has been
    // reordering underneath the finger the whole time.
    const from = current.findIndex((item) => item.id === drag.itemId);
    if (from === -1) return;

    // Read per move, not snapshotted: rects are viewport-relative, and a
    // mid-drag scroll or breakpoint change moves every cell. A `null` keeps its
    // index so positions stay aligned.
    const rects = slotRefs.current.map(
      (slot) => slot?.getBoundingClientRect() ?? null,
    );
    const hit = rects.findIndex(
      (rect) =>
        rect !== null &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom,
    );
    // Outside every cell: the drag waits.
    if (hit === -1) return;
    // A slot past the last item — a fixed row after the list, the home
    // strip's «خودکار» tiles — holds the drag at the last item's place: those
    // rows never move and never take an item's place, however fast the
    // pointer crossed the last item to get there.
    const target = Math.min(hit, current.length - 1);
    // Already there: the drag waits.
    if (target === from) return;
    moveTo(from, target);
  };

  // One string, so React renders one text node and the toggle is a
  // `characterData` change on the node holding the sentence. Two adjacent
  // children would be two text nodes, and React would then add or *remove* the
  // second — an addition whose whole content is a space, or a removal, which
  // the region's default `aria-relevant` ("additions text") excludes outright.
  // Either way the sentence itself would not be in the changed subtree, so a
  // repeat announced nothing, which is the defect the counter exists to cure.
  // The space is constructed from an escape, per the repo's rule on invisible
  // characters.
  const liveRegionProps = {
    'aria-live': 'polite',
    'aria-atomic': true,
    className: 'sr-only',
    children: announcement.text + '\u00A0'.repeat(announcement.seq % 2),
  } as const;

  return {
    slotRefs,
    draggingId,
    announce,
    onHandleKeyDown,
    onHandlePointerDown,
    liveRegionProps,
  };
}
