// Pins the category picker's numbered list: the home strip's six tiles, or a
// routine tab's picks, dragged or arrowed into the order the section shows.
//
// Why a component test: `value` is a prop this component itself causes to
// change, so what matters is the moment between «the admin moved a row» and
// «the parent handed back a new list» — which row moved, where focus went,
// what was said. The ordering rule underneath (`homeTiles`) has its own unit
// test and would pass with every one of these bugs in place.
//
// Rendered through a controlled harness — real state, real re-render —
// because a stub `onChange` would freeze the list at its first value.
import { useState } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOME_CATEGORY_TILES, homeTiles } from '@/lib/catalog/category-tree';
import { MAX_ROUTINE_CATEGORIES } from '@/lib/content/site-content';
import { CategoryPicker, type LinkOption } from './link-picker';

afterEach(cleanup);

/** Seven main categories in display order: the strip shows the first six. */
const MAIN: LinkOption[] = [
  { id: 'dry', title: 'غذای خشک', slug: 'dry-food' },
  { id: 'toys', title: 'اسباب‌بازی', slug: 'toys' },
  { id: 'treats', title: 'تشویقی', slug: 'treats' },
  { id: 'supplements', title: 'مکمل', slug: 'supplements' },
  { id: 'hygiene', title: 'بهداشت', slug: 'hygiene' },
  { id: 'wet', title: 'غذای تر', slug: 'wet-food' },
  { id: 'collars', title: 'قلاده', slug: 'collars' },
];
const [DRY, TOYS, TREATS, SUPPLEMENTS, HYGIENE, WET, COLLARS] = MAIN;
/** A category id the catalog no longer has. */
const GONE = 'gone';

const HOME_UMAMI = {
  toggle: 'admin-panel-content-home-category-toggle',
  reorder: 'admin-panel-content-home-category-reorder',
};
const ROUTINE_UMAMI = {
  toggle: 'admin-panel-content-routine-category-toggle',
  reorder: 'admin-panel-content-routine-category-reorder',
};

function Harness({
  initial,
  categories,
  home,
  onChange,
}: {
  initial: string[] | undefined;
  categories: LinkOption[];
  home: boolean;
  onChange: (next: string[] | undefined) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <CategoryPicker
      id="picks"
      label="دسته‌بندی‌ها"
      value={value}
      fallback="dry-food, toys"
      categories={categories}
      max={home ? HOME_CATEGORY_TILES : MAX_ROUTINE_CATEGORIES}
      umami={home ? HOME_UMAMI : ROUTINE_UMAMI}
      shows={home ? (picked) => homeTiles(categories, picked) : undefined}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

/** The home strip's picker, holding `initial`; returns what it hands back. */
const showHome = (initial?: string[]) => {
  const onChange = vi.fn();
  render(
    <Harness initial={initial} categories={MAIN} home onChange={onChange} />,
  );
  return onChange;
};

/** A routine tab's picker: no «خودکار» rows, at most four picks. */
const showRoutine = (initial?: string[], categories: LinkOption[] = MAIN) => {
  const onChange = vi.fn();
  render(
    <Harness
      initial={initial}
      categories={categories}
      home={false}
      onChange={onChange}
    />,
  );
  return onChange;
};

const rows = () => within(screen.getByRole('list')).getAllByRole('listitem');

/** Each row's visible parts joined: «۲ تشویقی», or «۳ مکمل خودکار» for a filled slot. */
const listed = () =>
  rows().map((row) =>
    [...row.children]
      .map((part) => part.textContent)
      .filter(Boolean)
      .join(' '),
  );

const grip = (category: LinkOption) =>
  screen.getByRole('button', { name: `جابه‌جایی ${category.title}` });

const grips = () => screen.queryAllByRole('button', { name: /^جابه‌جایی/ });

const box = (title: string) =>
  screen.getByRole('checkbox', { name: title }) as HTMLInputElement;

const activeLabel = () => document.activeElement?.getAttribute('aria-label');

/** The one polite line every move speaks through. */
const announced = () =>
  document.querySelector('[aria-live="polite"]')?.textContent ?? '';

const press = (category: LinkOption, key: string) =>
  fireEvent.keyDown(grip(category), { key });

/**
 * Lay the rows out top to bottom, 50px apart, because happy-dom does no
 * layout and reports every rect as zero-sized. Only `getBoundingClientRect`
 * is faked — the gesture itself runs on real window events.
 */
const layOutRows = () => {
  rows().forEach((row, index) => {
    row.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 300,
        top: index * 50,
        bottom: index * 50 + 44,
      }) as DOMRect;
  });
};

/** The y that lands inside the row at `index`, per `layOutRows`. */
const yOf = (index: number) => index * 50 + 22;

/** A window pointer event, the way the gesture receives one. */
const pointer = (type: string, row: number, pointerId = 1) =>
  act(() => {
    window.dispatchEvent(
      new PointerEvent(type, {
        clientX: 150,
        clientY: yOf(row),
        pointerId,
        bubbles: true,
      }),
    );
  });

/** Drag `category`'s grip onto the row at `to` in one move, and let go. */
const drag = (category: LinkOption, to: number) => {
  layOutRows();
  fireEvent.pointerDown(grip(category), { button: 0, pointerId: 1 });
  pointer('pointermove', to);
  pointer('pointerup', to);
};

describe('the home tile list', () => {
  it('numbers the six tiles, the picks first and then the rest by display order, marked «خودکار»', () => {
    showHome([COLLARS.id, TREATS.id]);

    expect(listed()).toEqual([
      '۱ قلاده',
      '۲ تشویقی',
      '۳ غذای خشک خودکار',
      '۴ اسباب‌بازی خودکار',
      '۵ مکمل خودکار',
      '۶ بهداشت خودکار',
    ]);
    // Only a pick has a grip: a filled slot is not a control at all, so it
    // is neither draggable nor in the tab order.
    expect(grips().map((button) => button.getAttribute('aria-label'))).toEqual([
      'جابه‌جایی قلاده',
      'جابه‌جایی تشویقی',
    ]);
    // The row itself as well as what it holds: `querySelector` never matches
    // the element it is called on.
    for (const row of rows().slice(2)) {
      expect(row.matches('[tabindex]')).toBe(false);
      expect(row.querySelector('button, [tabindex]')).toBeNull();
    }
  });

  it('shows six «خودکار» rows and saves nothing while nothing is picked', () => {
    const onChange = showHome();

    expect(listed()).toEqual([
      '۱ غذای خشک خودکار',
      '۲ اسباب‌بازی خودکار',
      '۳ تشویقی خودکار',
      '۴ مکمل خودکار',
      '۵ بهداشت خودکار',
      '۶ غذای تر خودکار',
    ]);
    expect(grips()).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('has no «خودکار» row once six are picked', () => {
    showHome([WET.id, DRY.id, TOYS.id, TREATS.id, SUPPLEMENTS.id, HYGIENE.id]);

    expect(listed()).toEqual([
      '۱ غذای تر',
      '۲ غذای خشک',
      '۳ اسباب‌بازی',
      '۴ تشویقی',
      '۵ مکمل',
      '۶ بهداشت',
    ]);
    expect(grips()).toHaveLength(6);
  });

  it('puts a newly ticked category after the last pick, before the «خودکار» rows', () => {
    // Picked in an order display order would never give, so a tick sorted
    // into display order, or put first, reads differently from one appended.
    const onChange = showHome([COLLARS.id, TREATS.id]);

    fireEvent.click(box(SUPPLEMENTS.title));

    expect(listed().slice(0, 4)).toEqual([
      '۱ قلاده',
      '۲ تشویقی',
      '۳ مکمل',
      '۴ غذای خشک خودکار',
    ]);
    expect(onChange).toHaveBeenLastCalledWith([
      COLLARS.id,
      TREATS.id,
      SUPPLEMENTS.id,
    ]);
  });

  it('drops an unticked pick’s row, keeps the others in order and fills the freed slot', () => {
    showHome([COLLARS.id, TREATS.id, SUPPLEMENTS.id]);

    fireEvent.click(box(TREATS.title));

    expect(listed()).toEqual([
      '۱ قلاده',
      '۲ مکمل',
      '۳ غذای خشک خودکار',
      '۴ اسباب‌بازی خودکار',
      '۵ تشویقی خودکار',
      '۶ بهداشت خودکار',
    ]);
  });

  it('keeps a deleted pick ticked but out of the list, through a reorder', () => {
    const onChange = showHome([GONE, COLLARS.id, TREATS.id]);

    // Ticked, under its own name, so the admin can see it and untick it…
    expect(box('دسته‌بندی حذف‌شده').checked).toBe(true);
    // …but not a row: the list shows only what the strip will render.
    expect(listed().slice(0, 3)).toEqual([
      '۱ قلاده',
      '۲ تشویقی',
      '۳ غذای خشک خودکار',
    ]);

    press(TREATS, 'ArrowUp');

    // The rows keep lining up with the picks they show, and the deleted one
    // rides along behind them rather than silently dropping out of the save.
    expect(onChange).toHaveBeenLastCalledWith([TREATS.id, COLLARS.id, GONE]);
    expect(listed().slice(0, 2)).toEqual(['۱ تشویقی', '۲ قلاده']);
    expect(box('دسته‌بندی حذف‌شده').checked).toBe(true);
  });
});

describe('dragging a pick', () => {
  it('moves it toward the end of the picks', () => {
    const onChange = showHome([DRY.id, TOYS.id, TREATS.id]);

    drag(DRY, 2);

    expect(listed().slice(0, 4)).toEqual([
      '۱ اسباب‌بازی',
      '۲ تشویقی',
      '۳ غذای خشک',
      '۴ مکمل خودکار',
    ]);
    expect(onChange).toHaveBeenLastCalledWith([TOYS.id, TREATS.id, DRY.id]);
  });

  it('moves it toward the start', () => {
    showHome([DRY.id, TOYS.id, TREATS.id]);

    drag(TREATS, 0);

    expect(listed().slice(0, 3)).toEqual([
      '۱ تشویقی',
      '۲ غذای خشک',
      '۳ اسباب‌بازی',
    ]);
  });

  it('follows the pointer across several rows in one gesture, marking the row only while it runs', () => {
    showHome([DRY.id, TOYS.id, TREATS.id]);
    layOutRows();

    fireEvent.pointerDown(grip(DRY), { button: 0, pointerId: 1 });
    pointer('pointermove', 1);
    layOutRows();
    pointer('pointermove', 2);
    // The dragged row is marked while the finger is down…
    expect(document.querySelectorAll('[data-category-dragging]')).toHaveLength(
      1,
    );
    pointer('pointerup', 2);

    // …two hops in one gesture, the second arriving only if the first did
    // not end the drag…
    expect(listed().slice(0, 3)).toEqual([
      '۱ اسباب‌بازی',
      '۲ تشویقی',
      '۳ غذای خشک',
    ]);
    // …and no row is marked once it is let go.
    expect(document.querySelectorAll('[data-category-dragging]')).toHaveLength(
      0,
    );
  });

  it('stops a pick dragged onto a «خودکار» row at the last picked place', () => {
    showHome([DRY.id, TOYS.id]);

    // Straight from the first row onto the fifth, a filled slot, without
    // crossing the last pick on the way — a flick.
    drag(DRY, 4);

    // The pick went as far as a pick can go, and the filled slots neither
    // moved nor let it in among them.
    expect(listed()).toEqual([
      '۱ اسباب‌بازی',
      '۲ غذای خشک',
      '۳ تشویقی خودکار',
      '۴ مکمل خودکار',
      '۵ بهداشت خودکار',
      '۶ غذای تر خودکار',
    ]);
  });
});

// What the focus assertions can and cannot see. A keyed reorder that moves
// the focused grip drops focus — in happy-dom as in Chrome — and React's own
// commit hands it straight back to the element that had it. So these pin what
// the admin gets, focus staying on the grip that moved, but not who restored
// it: with the hook pointed at the wrong handle selector they still pass, here
// and in `e2e/admin-settings.spec.ts`, which presses the arrows in Chrome.
describe('the arrow keys on a grip', () => {
  it('move a pick toward the end on ArrowDown and ArrowLeft, focus staying on its grip', () => {
    const onChange = showHome([DRY.id, TOYS.id, TREATS.id]);
    grip(DRY).focus();

    press(DRY, 'ArrowDown');
    expect(listed().slice(0, 3)).toEqual([
      '۱ اسباب‌بازی',
      '۲ غذای خشک',
      '۳ تشویقی',
    ]);
    // The pin: focus followed the category, not the position — the grip the
    // admin pressed is the one still holding it, at its new place.
    expect(activeLabel()).toBe('جابه‌جایی غذای خشک');

    // RTL: left is toward the end of the list.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(listed().slice(0, 3)).toEqual([
      '۱ اسباب‌بازی',
      '۲ تشویقی',
      '۳ غذای خشک',
    ]);
    expect(activeLabel()).toBe('جابه‌جایی غذای خشک');
    expect(onChange).toHaveBeenLastCalledWith([TOYS.id, TREATS.id, DRY.id]);
  });

  it('move a pick toward the start on ArrowUp and ArrowRight, focus staying on its grip', () => {
    showHome([DRY.id, TOYS.id, TREATS.id]);
    grip(TREATS).focus();

    press(TREATS, 'ArrowUp');
    // RTL: right is toward the start.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });

    expect(listed().slice(0, 3)).toEqual([
      '۱ تشویقی',
      '۲ غذای خشک',
      '۳ اسباب‌بازی',
    ]);
    expect(activeLabel()).toBe('جابه‌جایی تشویقی');
  });

  it('do nothing, and say nothing, past either end of the picks', () => {
    const onChange = showHome([DRY.id, TOYS.id]);
    const before = listed();

    // The first pick toward the start…
    press(DRY, 'ArrowUp');
    press(DRY, 'ArrowRight');
    // …and the last toward the end, where the «خودکار» rows begin.
    press(TOYS, 'ArrowDown');
    press(TOYS, 'ArrowLeft');

    expect(listed()).toEqual(before);
    expect(onChange).not.toHaveBeenCalled();
    expect(announced()).toBe('');
  });
});

describe('what a move says', () => {
  it('names the category and the place it landed', () => {
    showHome([DRY.id, TOYS.id, TREATS.id]);

    press(DRY, 'ArrowDown');

    expect(announced()).toContain('غذای خشک به جایگاه ۲ منتقل شد.');
  });

  it('still changes when the same move is announced twice in a row', () => {
    // A live region speaks only when its text changes. Moving a pick to the
    // same place twice running takes an untick and a re-tick in between,
    // which say nothing — so the second move repeats the first word for word.
    showHome([DRY.id, TOYS.id, TREATS.id]);

    press(DRY, 'ArrowDown');
    const first = announced();
    fireEvent.click(box(TOYS.title));
    fireEvent.click(box(TOYS.title));
    expect(listed().slice(0, 3)).toEqual([
      '۱ غذای خشک',
      '۲ تشویقی',
      '۳ اسباب‌بازی',
    ]);
    press(DRY, 'ArrowDown');

    expect(first).toContain('غذای خشک به جایگاه ۲ منتقل شد.');
    expect(announced()).toContain('غذای خشک به جایگاه ۲ منتقل شد.');
    expect(announced()).not.toBe(first);
  });

  it('names each grip for its category and describes it with the drag hint', () => {
    showHome([COLLARS.id]);
    const hint = grip(COLLARS).getAttribute('aria-describedby');

    expect(document.getElementById(hint ?? '')?.textContent).toBe(
      'برای جابه‌جایی، بکش و رها کن یا با کلیدهای جهت‌نما حرکت بده.',
    );
  });
});

describe('a routine tab’s list', () => {
  it('numbers only the picks, with no «خودکار» row, and says the fallback while none is picked', () => {
    showRoutine();

    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText('dry-food, toys', { exact: false })).toBeTruthy();

    fireEvent.click(box(TREATS.title));
    fireEvent.click(box(DRY.title));

    expect(listed()).toEqual(['۱ تشویقی', '۲ غذای خشک']);
    expect(grips()).toHaveLength(2);
    expect(screen.queryByText('dry-food, toys', { exact: false })).toBeNull();
  });

  it('reads a sub-category’s plain title, never its indented label', () => {
    const grooming = {
      id: 'grooming',
      title: 'شامپو و نظافت',
      slug: 'grooming',
      label: '— شامپو و نظافت',
    };
    showRoutine([grooming.id], [HYGIENE, grooming]);

    expect(listed()).toEqual(['۱ شامپو و نظافت']);
    expect(grip(grooming).getAttribute('aria-label')).toBe(
      'جابه‌جایی شامپو و نظافت',
    );
  });

  it('moves a pick by drag and by key, as the home list does', () => {
    const onChange = showRoutine([DRY.id, TOYS.id, TREATS.id]);

    drag(TREATS, 0);
    press(DRY, 'ArrowDown');

    expect(listed()).toEqual(['۱ تشویقی', '۲ اسباب‌بازی', '۳ غذای خشک']);
    expect(onChange).toHaveBeenLastCalledWith([TREATS.id, TOYS.id, DRY.id]);
    expect(announced()).toContain('غذای خشک به جایگاه ۳ منتقل شد.');
  });
});
