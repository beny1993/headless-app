// Pins the picker's three accessibility wirings, none of which any unit test
// can see: they are attributes on one element pointing at another, and they are
// only true of the rendered tree.
//
// All three were live defects. The field's label is a `<p>`, and the only
// `<label htmlFor>` here wraps the upload BUTTON's words — so before the fix
// the input's accessible name was «تغییر تصویر» and «تصویر شاخص» reached
// nobody. The error was a bare `<p>`, shown and never announced. And the input
// is `sr-only`, so the global focus outline landed on something invisible.
//
// The picker renders in the content editor and in the category manager (the
// product form has its own multi-photo field). Their own tests pin how each
// uses it; this file proves the fixes — and the picker's own behaviours no
// caller's test can see: the hint it announces, the input it empties after
// every pick, and the input carrying its event name.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { trackedEventOf } from '@/components/umami-tracker';
import { IMAGE_TYPE_ERROR } from '@/lib/storage/image-upload';
import { ImagePicker } from './image-picker';

afterEach(cleanup);

const UMAMI = 'admin-panel-test-image';
const HINT = 'روی کاشی صفحه‌ی اصلی دیده می‌شود.';

const show = (
  error?: string,
  { hint, onPick = () => {} }: { hint?: string; onPick?: () => void } = {},
) =>
  render(
    <ImagePicker
      id="hero-image"
      label="تصویر شاخص"
      preview={null}
      error={error}
      buttonLabel="تغییر تصویر"
      onPick={onPick}
      umami={UMAMI}
      hint={hint}
    />,
  );

/** The texts an input's `aria-describedby` points at, in its order. */
const describedTexts = (input: HTMLElement) =>
  (input.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent);

it('names the input after the field, not after the upload button', () => {
  show();

  // `getByLabelText` resolves the accessible name, so this is the whole pin:
  // before the fix it answered to «تغییر تصویر» and to nothing else.
  const input = screen.getByLabelText('تصویر شاخص');
  expect(input.getAttribute('type')).toBe('file');
});

it('associates the error with the input and marks it invalid', () => {
  // The picker's own refusal, not a copy of it: hand-typed, this said JPEG
  // while the constant says JPG, so it read as a pin of a message that no
  // longer exists.
  show(IMAGE_TYPE_ERROR);

  const input = screen.getByLabelText('تصویر شاخص');
  const describedBy = input.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  expect(document.getElementById(describedBy!)?.textContent).toContain(
    IMAGE_TYPE_ERROR,
  );
  expect(input.getAttribute('aria-invalid')).toBe('true');
});

it('says nothing about an error there is none of', () => {
  show();

  const input = screen.getByLabelText('تصویر شاخص');
  expect(input.getAttribute('aria-describedby')).toBeNull();
  expect(input.getAttribute('aria-invalid')).toBeNull();
});

it('announces its hint with the input, after an error', () => {
  show(undefined, { hint: HINT });
  expect(describedTexts(screen.getByLabelText('تصویر شاخص'))).toEqual([HINT]);

  cleanup();
  show(IMAGE_TYPE_ERROR, { hint: HINT });
  const [error, hint] = describedTexts(screen.getByLabelText('تصویر شاخص'));
  expect(error).toContain(IMAGE_TYPE_ERROR);
  expect(hint).toBe(HINT);
});

it('empties the input after a pick, so picking that file again still counts', () => {
  const onPick = vi.fn();
  show(undefined, { onPick });
  const input = screen.getByLabelText('تصویر شاخص') as HTMLInputElement;
  const file = new File(['x'], 'photo.png', { type: 'image/png' });

  // Through the input's own `files` setter, as a browser sets it: fireEvent's
  // `target.files` would shadow the property and fire whatever the value was.
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  expect(input.value).not.toBe('');
  fireEvent.change(input);

  expect(onPick).toHaveBeenCalledWith(file);
  // Still holding the file, the input would fire no change for the same pick.
  expect(input.value).toBe('');
});

it('carries its event name on the input, which the label forwards taps to', () => {
  show();
  const input = screen.getByLabelText('تصویر شاخص');

  // On the label instead, a tap on its camera icon would read the unnamed
  // icon, and the click the label forwards would reach an unnamed input.
  expect(trackedEventOf(input)).toBe(UMAMI);
  expect(input.closest('label')!.hasAttribute('data-umami-event')).toBe(false);
});

it('puts the focus treatment on the styled label that can actually show it', () => {
  show();

  const input = screen.getByLabelText('تصویر شاخص');
  // The input is visually hidden, so the global `*:focus-visible` outline has
  // nothing to draw on. The fix is `has-[:focus-visible]` on the styled label
  // — which only works while the input is inside it, so the nesting is the
  // load-bearing part and is what this asserts.
  const styled = input.closest('label');
  expect(styled).not.toBeNull();
  expect(styled!.className).toContain('has-[:focus-visible]:outline-2');
  expect(styled!.className).toContain('has-[:focus-visible]:outline-ring');
});
