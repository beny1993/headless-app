// Pins the wiring `useModalDialog` gives every native modal `<dialog>` on the
// site (the mobile menu, the cart drawer, the shop's filter sheet): the `open`
// mirror behind aria-expanded has to follow every way the dialog can close.
// That window exists only at runtime, so no unit test can reach it.
//
// Asserted on the trigger's aria-expanded only — never the dialog's own `open`
// state, so the pin does not rest on happy-dom's partial `<dialog>`.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalDialog } from './use-modal-dialog';

// happy-dom's `close()` dispatches a `close` event, which would let `onClose`
// quietly do `close()`'s second half and hide a missing one. Chromium was
// measured not to fire it here, so the stub closes the way that browser does:
// the attribute goes, no event follows.
beforeEach(() => {
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.removeAttribute('open');
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Host() {
  const { open, show, close, dialogProps } = useModalDialog();
  return (
    <>
      <button type="button" onClick={show} aria-expanded={open}>
        باز
      </button>
      <dialog {...dialogProps} aria-label="پنجره">
        <div>
          <p>محتوا</p>
          <button type="button" onClick={close}>
            بستن
          </button>
        </div>
      </dialog>
    </>
  );
}

const trigger = () => screen.getByRole('button', { name: 'باز' });
const dialog = () => screen.getByLabelText('پنجره');
const openIt = () => {
  fireEvent.click(trigger());
  expect(trigger().getAttribute('aria-expanded')).toBe('true');
};

describe('useModalDialog', () => {
  it('starts closed', () => {
    render(<Host />);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape', () => {
    render(<Host />);
    openIt();
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('ignores any other key', () => {
    render(<Host />);
    openIt();
    fireEvent.keyDown(dialog(), { key: 'Enter' });
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('closes on a backdrop click — one whose target is the dialog itself', () => {
    render(<Host />);
    openIt();
    fireEvent.click(dialog());
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('stays open on a click inside the panel', () => {
    render(<Host />);
    openIt();
    fireEvent.click(screen.getByText('محتوا'));
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('closes through its own close button', () => {
    render(<Host />);
    openIt();
    fireEvent.click(screen.getByRole('button', { name: 'بستن', hidden: true }));
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('follows a close the browser performs on its own', () => {
    render(<Host />);
    openIt();
    fireEvent(dialog(), new Event('close'));
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });
});
