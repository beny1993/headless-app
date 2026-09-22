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
// The content editor is this picker's only render site now that the product
// form has its own multi-photo field, so «unchanged for both callers» is what
// content-editor.test.tsx next door proves; this file proves the fixes.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { IMAGE_TYPE_ERROR } from '@/lib/storage/image-upload';
import { ImagePicker } from './image-picker';

afterEach(cleanup);

const show = (error?: string) =>
  render(
    <ImagePicker
      id="hero-image"
      label="تصویر شاخص"
      preview={null}
      error={error}
      buttonLabel="تغییر تصویر"
      onPick={() => {}}
    />,
  );

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
