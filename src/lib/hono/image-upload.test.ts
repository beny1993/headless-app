// The upload boundary's refusals, answered through the app's real error handler
// and with NO `bodyLimit` in front — the size check here is the backstop the
// route integration suites cannot reach, since their mounted guard refuses an
// oversize body first.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_FIELD_NAME, MAX_UPLOAD_BYTES } from '@/lib/storage/image-upload';
import { apiErrorHandler, createRouter } from './create-router';
import {
  IMAGE_TOO_LARGE_MESSAGE,
  INVALID_IMAGE_MESSAGE,
  NO_IMAGE_FILE_MESSAGE,
  readImageUpload,
} from './image-upload';

const app = createRouter();
app.onError(apiErrorHandler);
app.post('/upload', async (c) => {
  const { bytes, type } = await readImageUpload(c);
  return c.json({ size: bytes.byteLength, type });
});

/** A minimal JPEG header padded out to `size` bytes. */
const jpeg = (size = 64) => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
};

const send = (file?: File) => {
  const form = new FormData();
  if (file) form.append(IMAGE_FIELD_NAME, file);
  return app.request('/upload', { method: 'POST', body: form });
};

afterEach(() => vi.restoreAllMocks());

describe('readImageUpload', () => {
  it('hands back the bytes and the sniffed type', async () => {
    const res = await send(new File([jpeg()], 'a.png', { type: 'image/png' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ size: 64, type: 'image/jpeg' });
  });

  it.each([
    ['no file field', undefined, 400, NO_IMAGE_FILE_MESSAGE],
    ['an empty file', new File([], 'a.jpg'), 400, NO_IMAGE_FILE_MESSAGE],
    [
      'bytes that are not an image',
      new File(['<?php echo 1; ?>'], 'a.jpg', { type: 'image/jpeg' }),
      400,
      INVALID_IMAGE_MESSAGE,
    ],
    [
      'a file past the ceiling',
      new File([jpeg(MAX_UPLOAD_BYTES + 1)], 'a.jpg'),
      413,
      IMAGE_TOO_LARGE_MESSAGE,
    ],
  ])('refuses %s with the error envelope', async (_, file, status, message) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await send(file);

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ status: 'error', message });
  });
});
