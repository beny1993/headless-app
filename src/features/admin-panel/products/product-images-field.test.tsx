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
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  it('revokes a pending pick’s blob so the form does not leak one per pick', () => {
    render(<Harness initial={[]} />);
    fireEvent.change(fileInput(), { target: { files: [png('cat.png')] } });

    fireEvent.click(screen.getByRole('button', { name: 'حذف عکس اصلی' }));

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:0');
    expect(screen.getByText('هنوز عکسی اضافه نشده است.')).toBeTruthy();
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
  });
});
