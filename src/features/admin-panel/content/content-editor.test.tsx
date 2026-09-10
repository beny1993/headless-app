import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentEditor } from './content-editor';
import { DEFAULT_CONTENT } from '@/lib/content/defaults';

const { putData } = vi.hoisted(() => ({ putData: vi.fn() }));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  putData,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('content editor save boundary', () => {
  it('unlocks image and text fields after an upload failure and permits retry', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('upload failed'));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    render(
      <ContentEditor
        keys={['home.hero']}
        values={{ 'home.hero': DEFAULT_CONTENT['home.hero'] }}
      />,
    );
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: {
        files: [new File(['image'], 'cat.png', { type: 'image/png' })],
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
    });
    expect(screen.getByRole('alert').textContent).toContain('upload failed');
    expect(putData).not.toHaveBeenCalled();
    expect(document.querySelector('fieldset')?.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  for (const succeeds of [true, false]) {
    it(`locks edits while saving and unlocks after ${succeeds ? 'success' : 'failure'}`, async () => {
      let finish!: (value: unknown) => void;
      let fail!: (reason: Error) => void;
      putData.mockReturnValue(
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
      );
      render(
        <ContentEditor
          keys={['home.philosophy']}
          values={{ 'home.philosophy': DEFAULT_CONTENT['home.philosophy'] }}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'ذخیره' }));
      fireEvent.submit(document.querySelector('form')!);
      expect(putData).toHaveBeenCalledOnce();
      const fields = Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          'input, textarea',
        ),
      );
      expect(fields.length).toBeGreaterThan(0);
      // A native disabled fieldset locks text, visibility and image controls.
      expect(
        fields.every((field) => field.closest('fieldset')?.disabled === true),
      ).toBe(true);
      await act(async () => {
        if (succeeds)
          finish({
            key: 'home.philosophy',
            value: DEFAULT_CONTENT['home.philosophy'],
          });
        else fail(new Error('save failed'));
      });
      expect(
        fields.every((field) => field.closest('fieldset')?.disabled === false),
      ).toBe(true);
      if (!succeeds)
        expect(screen.getByRole('alert').textContent).toContain('save failed');
    });
  }
});
