// Pins the gallery field's reorder and remove wiring.
//
// Why a component test: `photos` is a prop this component itself causes to
// change, so the interesting moment is the one between «the admin pressed a
// key» and «the parent handed back a new list» — the window the testing
// standard names as the third case no unit test can reach. The pure part (the
// array move) is three lines and would pass with every one of these bugs in
// place: keying the tiles by index, mapping the RTL arrows the wrong way,
// renumbering off by one. What those break is what a keyboard admin sees and
// where their focus lands, which only exists at runtime.
//
// Rendered through a controlled harness — real state, real re-render — because
// a stub `onChange` would freeze the list at its first value and there would be
// nothing to sync.
import { useState } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PRODUCT_IMAGES } from '@/lib/catalog/product-input';
import { ProductImagesField, type ProductPhoto } from './product-images-field';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // happy-dom implements `createObjectURL` through Node's URL, which wants a
  // real Blob; the tests only care that a distinguishable string comes back.
  let next = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${next++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

const saved = (n: number): ProductPhoto => ({
  id: `row-${n}`,
  kind: 'saved',
  objectKey: `uploads/photo-${n}.jpg`,
});

const png = (name: string) =>
  new File([new Uint8Array([0x89, 0x50])], name, { type: 'image/png' });

function Harness({ initial }: { initial: ProductPhoto[] }) {
  const [photos, setPhotos] = useState(initial);
  return (
    <ProductImagesField id="images" photos={photos} onChange={setPhotos} />
  );
}

const show = (count: number) =>
  render(
    <Harness
      initial={Array.from({ length: count }, (_, index) => saved(index + 1))}
    />,
  );

/** Every handle's label, in DOM order — which is also the gallery's order. */
const handleLabels = () =>
  screen
    .getAllByRole('button', { name: /^جابه‌جایی/ })
    .map((handle) => handle.getAttribute('aria-label'));

const fileInput = () =>
  document.querySelector('input[type="file"]') as HTMLInputElement;

const activeLabel = () => document.activeElement?.getAttribute('aria-label');

/** The object key behind each tile's preview, in DOM order. */
const previewOrder = () =>
  tiles().map((tile) => {
    const src = tile.querySelector('img')?.getAttribute('src') ?? '';
    return decodeURIComponent(src).replace(/^.*?(uploads\/[^&?"]+).*$/, '$1');
  });

/** The one polite line reorder, add, remove and a refusal all speak through. */
const announced = () =>
  document.querySelector('[aria-live="polite"]')?.textContent ?? '';

describe('keyboard reorder', () => {
  it('moves a photo toward the start on ArrowRight and keeps its handle focused', () => {
    show(3);
    const second = screen.getByRole('button', { name: 'جابه‌جایی عکس ۲' });
    second.focus();

    fireEvent.keyDown(second, { key: 'ArrowRight' });

    // Photo 2 is now the cover, and the one it passed is «عکس ۲».
    expect(handleLabels()).toEqual([
      'جابه‌جایی عکس اصلی',
      'جابه‌جایی عکس ۲',
      'جابه‌جایی عکس ۳',
    ]);
    // The pin: focus is still on the photo the admin moved — it followed the
    // tile to its new place rather than staying on whatever now sits at the
    // old one. That only holds while tiles are keyed by identity.
    expect(activeLabel()).toBe('جابه‌جایی عکس اصلی');
    expect(screen.getByText('عکس اصلی')).toBeTruthy();
  });

  it('moves a photo toward the end on ArrowLeft', () => {
    show(3);
    const cover = screen.getByRole('button', { name: 'جابه‌جایی عکس اصلی' });
    cover.focus();

    fireEvent.keyDown(cover, { key: 'ArrowLeft' });

    expect(activeLabel()).toBe('جابه‌جایی عکس ۲');
  });

  it('refuses to move the cover past the start', () => {
    show(3);
    const cover = screen.getByRole('button', { name: 'جابه‌جایی عکس اصلی' });
    cover.focus();

    fireEvent.keyDown(cover, { key: 'ArrowRight' });

    expect(activeLabel()).toBe('جابه‌جایی عکس اصلی');
    expect(handleLabels()).toHaveLength(3);
  });

  it('announces where the photo landed', () => {
    show(3);
    const third = screen.getByRole('button', { name: 'جابه‌جایی عکس ۳' });
    third.focus();

    fireEvent.keyDown(third, { key: 'ArrowUp' });

    expect(
      screen.getByText('عکس ۳ به جایگاه ۲ منتقل شد.', { exact: false }),
    ).toBeTruthy();
  });

  it('says the moved photo is now the cover when it reaches the front', () => {
    show(3);
    const third = screen.getByRole('button', { name: 'جابه‌جایی عکس ۳' });
    third.focus();
    // Two steps, and each names the photo by where it was when it set off —
    // so the second says «عکس ۲», which is where the first left it.
    fireEvent.keyDown(third, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });

    expect(
      screen.getByText('عکس ۲ به جایگاه ۱ منتقل شد؛ حالا عکس اصلی است.'),
    ).toBeTruthy();
  });
});

describe('remove', () => {
  it('removes the photo it names and renumbers the rest', () => {
    show(3);

    fireEvent.click(screen.getByRole('button', { name: 'حذف عکس ۲' }));

    expect(handleLabels()).toEqual(['جابه‌جایی عکس اصلی', 'جابه‌جایی عکس ۲']);
    expect(screen.getByText('عکس ۲ حذف شد.')).toBeTruthy();
  });

  it('removing the cover promotes the next photo', () => {
    show(3);

    fireEvent.click(screen.getByRole('button', { name: 'حذف عکس اصلی' }));

    expect(handleLabels()).toEqual(['جابه‌جایی عکس اصلی', 'جابه‌جایی عکس ۲']);
  });

  // The remove button unmounts with the tile it sits on, and a browser drops
  // focus to `<body>` when the focused element goes — ending a keyboard
  // admin's traversal at the top of the document, silently. QA saw exactly
  // that; these three pin where focus goes instead.
  it('moves focus to the tile that took the removed one’s place', () => {
    show(3);

    fireEvent.click(screen.getByRole('button', { name: 'حذف عکس ۲' }));

    // The third photo has slid into the second slot and is now «عکس ۲».
    expect(activeLabel()).toBe('حذف عکس ۲');
  });

  it('moves focus to the new last tile when the removed one was last', () => {
    show(3);

    fireEvent.click(screen.getByRole('button', { name: 'حذف عکس ۳' }));

    // Nothing took its place, so focus falls back to the end of the list.
    expect(activeLabel()).toBe('حذف عکس ۲');
  });

  it('moves focus to the add control when the last photo goes', () => {
    show(1);

    fireEvent.click(screen.getByRole('button', { name: 'حذف عکس اصلی' }));

    // No tiles left: the add tile is the only thing on screen that still does
    // anything, and its input is what carries focus.
    expect(document.activeElement).toBe(fileInput());
  });

  it('revokes a pending pick’s blob so the form does not leak one per pick', () => {
    render(<Harness initial={[]} />);
    fireEvent.change(fileInput(), { target: { files: [png('cat.png')] } });

    fireEvent.click(screen.getByRole('button', { name: 'حذف عکس اصلی' }));

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:0');
    expect(screen.getByText('هنوز عکسی اضافه نشده است.')).toBeTruthy();
  });
});

/**
 * The photo tiles, in DOM order. A tile is an `<li>` carrying a remove button;
 * the add tile has none.
 */
const tiles = () =>
  [...document.querySelectorAll('li')].filter((li) =>
    li.querySelector('[data-photo-remove]'),
  );

/**
 * Lay the tiles out in a row 100px apart and stub each one's rect, because
 * happy-dom does no layout and reports every rect as zero-sized. Only
 * `getBoundingClientRect` needs faking — the gesture itself runs on real
 * window events, so everything else about it is exercised for real.
 */
const layOutTiles = () => {
  tiles().forEach((tile, index) => {
    tile.getBoundingClientRect = () =>
      ({
        left: index * 100,
        right: index * 100 + 90,
        top: 0,
        bottom: 90,
      }) as DOMRect;
  });
};

/** The x that lands inside the cell at `index`, per `layOutTiles`. */
const xOf = (index: number) => index * 100 + 45;

/**
 * Dispatch a window pointer event the way the gesture receives one. Wrapped in
 * `act` because these listeners are outside React's own event system, so the
 * state they set is not flushed before the next assertion otherwise.
 */
const pointer = (type: string, clientX: number, pointerId = 1) =>
  act(() => {
    window.dispatchEvent(
      new PointerEvent(type, {
        clientX,
        clientY: 45,
        pointerId,
        bubbles: true,
      }),
    );
  });

/** Drag the handle at `from` onto the cell at `to`, the way a finger would. */
const drag = (from: number, to: number, pointerId = 1) => {
  const handle = screen.getAllByRole('button', { name: /^جابه‌جایی/ })[from];
  layOutTiles();
  fireEvent.pointerDown(handle, { button: 0, pointerId });
  pointer('pointermove', xOf(to), pointerId);
  pointer('pointerup', xOf(to), pointerId);
};

describe('pointer drag', () => {
  // The direction that used to die after one cell. React reorders a keyed list
  // with `insertBefore`, which drops pointer capture on the moved element and
  // fires neither `pointerup` nor `pointercancel` — so a handle-bound gesture
  // stopped receiving moves the moment it displaced the dragged tile. Only the
  // opposite direction worked, and that is the one the E2E spec dragged.
  it('drags a photo toward the end of the list', () => {
    show(3);

    drag(0, 2);

    expect(handleLabels()).toEqual([
      'جابه‌جایی عکس اصلی',
      'جابه‌جایی عکس ۲',
      'جابه‌جایی عکس ۳',
    ]);
    // Positional labels cannot show a reorder, so assert on the images: the
    // photo that was first is now last.
    expect(previewOrder()).toEqual([
      'uploads/photo-2.jpg',
      'uploads/photo-3.jpg',
      'uploads/photo-1.jpg',
    ]);
  });

  it('drags a photo toward the start of the list', () => {
    show(3);

    drag(2, 0);

    expect(previewOrder()).toEqual([
      'uploads/photo-3.jpg',
      'uploads/photo-1.jpg',
      'uploads/photo-2.jpg',
    ]);
  });

  it('keeps following the pointer across several cells in one gesture', () => {
    show(3);
    const handle = screen.getAllByRole('button', { name: /^جابه‌جایی/ })[0];
    layOutTiles();

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1 });
    pointer('pointermove', xOf(1));
    layOutTiles();
    pointer('pointermove', xOf(2));
    pointer('pointerup', xOf(2));

    // Two hops in one gesture: the second only arrives if the first did not
    // end the drag.
    expect(previewOrder()).toEqual([
      'uploads/photo-2.jpg',
      'uploads/photo-3.jpg',
      'uploads/photo-1.jpg',
    ]);
  });

  it('ignores a second finger while one is already dragging', () => {
    show(3);
    const handles = screen.getAllByRole('button', { name: /^جابه‌جایی/ });
    layOutTiles();

    fireEvent.pointerDown(handles[0], { button: 0, pointerId: 1 });
    // A second contact on another handle must not start a competing gesture,
    // and its moves must not reorder anything.
    fireEvent.pointerDown(handles[2], { button: 0, pointerId: 2 });
    pointer('pointermove', xOf(0), 2);
    pointer('pointerup', xOf(0), 2);

    expect(previewOrder()).toEqual([
      'uploads/photo-1.jpg',
      'uploads/photo-2.jpg',
      'uploads/photo-3.jpg',
    ]);
  });

  it('stops reordering once the gesture ends', () => {
    show(3);

    drag(0, 1);
    // A stray move after the release must not move anything.
    pointer('pointermove', xOf(2));

    expect(previewOrder()).toEqual([
      'uploads/photo-2.jpg',
      'uploads/photo-1.jpg',
      'uploads/photo-3.jpg',
    ]);
  });
});

describe('announcements', () => {
  // A live region speaks only when its text changes, and every message here is
  // a pure function of an index — so the same sentence twice was silence.
  it('changes the announced text when the same thing happens twice', () => {
    show(3);

    fireEvent.click(screen.getByRole('button', { name: 'حذف عکس ۲' }));
    const first = announced();
    fireEvent.click(screen.getByRole('button', { name: 'حذف عکس ۲' }));

    expect(first).toContain('عکس ۲ حذف شد.');
    expect(announced()).toContain('عکس ۲ حذف شد.');
    expect(announced()).not.toBe(first);
  });
});

describe('adding', () => {
  it('takes several files in one pick, in the order they were chosen', () => {
    render(<Harness initial={[]} />);

    fireEvent.change(fileInput(), {
      target: { files: [png('a.png'), png('b.png')] },
    });

    expect(handleLabels()).toEqual(['جابه‌جایی عکس اصلی', 'جابه‌جایی عکس ۲']);
    expect(screen.getByText('۲ عکس اضافه شد.')).toBeTruthy();
  });

  it('takes only what fits and says so', () => {
    show(MAX_PRODUCT_IMAGES - 1);

    fireEvent.change(fileInput(), {
      target: { files: [png('a.png'), png('b.png'), png('c.png')] },
    });

    expect(handleLabels()).toHaveLength(MAX_PRODUCT_IMAGES);
    expect(
      screen.getByText('فقط ۱ عکس اول اضافه شد؛ سقف ۵ عکس است.'),
    ).toBeTruthy();
    // And said out loud: this pick fills the last slot, which takes the add
    // tile — and the `aria-describedby` that points at the red line — away.
    expect(announced()).toContain('فقط ۱ عکس اول اضافه شد');
    // And the two that did not fit gave their blobs straight back.
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('hides the add tile at the cap and says why', () => {
    show(MAX_PRODUCT_IMAGES);

    expect(fileInput()).toBeNull();
    expect(
      screen.getByText('سقف ۵ عکس پر شده است؛ برای افزودن، یکی را حذف کن.', {
        exact: false,
      }),
    ).toBeTruthy();
  });

  it('names a refused file and still takes the acceptable ones', () => {
    render(<Harness initial={[]} />);

    fireEvent.change(fileInput(), {
      target: {
        files: [
          new File(['x'], 'cat.gif', { type: 'image/gif' }),
          png('dog.png'),
        ],
      },
    });

    expect(
      screen.getByText(
        'فایل «cat.gif» اضافه نشد: فقط تصویر JPEG، PNG یا WEBP.',
      ),
    ).toBeTruthy();
    expect(handleLabels()).toEqual(['جابه‌جایی عکس اصلی']);
    expect(fileInput().getAttribute('aria-invalid')).toBe('true');
    expect(announced()).toContain('فایل «cat.gif» اضافه نشد');
  });
});
