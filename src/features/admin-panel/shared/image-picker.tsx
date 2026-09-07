'use client';

import Image from 'next/image';
import { AlertCircle, Camera } from 'lucide-react';
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
} from '@/lib/storage/image-upload';

// The admin image slot, extracted from the product form so the product form and
// the content editor share one picker rather than two. Presentational: it shows
// the current preview (a bundled/upload URL, or a `blob:` URL for a just-picked
// file), a file input, the accept/size hint, and an error — and calls `onPick`
// with the chosen file. The when/where of the actual upload stays with each
// form; validation is the shared `validateImageFile` below, so the two Persian
// messages live in one place.

const IMAGE_TYPE_ERROR = 'فقط تصویر JPEG، PNG یا WEBP.';
const IMAGE_SIZE_ERROR = 'حجم تصویر باید حداکثر ۲ مگابایت باشد.';

/**
 * The client-side accept/size check, matching the server's trust boundary so a
 * file the browser lets through is one the upload route will too. Returns a
 * Persian message to show on the field, or `null` when the file is acceptable.
 * The server re-sniffs the bytes regardless — this is a courtesy, not the gate.
 */
export function validateImageFile(file: File): string | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return IMAGE_TYPE_ERROR;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return IMAGE_SIZE_ERROR;
  }
  return null;
}

export function ImagePicker({
  id,
  label,
  preview,
  error,
  buttonLabel,
  onPick,
}: {
  id: string;
  label: string;
  /** The URL to preview: an `imageSrc` result, or a `blob:` URL for a fresh pick. */
  preview: string | null;
  error?: string;
  buttonLabel: string;
  onPick: (file: File | undefined) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 block text-sm font-medium">{label}</p>
      <div className="flex items-center gap-4">
        <div className="bg-secondary relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl">
          {preview ? (
            <Image
              src={preview}
              alt=""
              fill
              sizes="96px"
              className="object-cover"
              unoptimized={preview.startsWith('blob:')}
            />
          ) : (
            <Camera
              size={22}
              className="text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </div>
        <div>
          <label
            htmlFor={id}
            className="border-border hover:bg-secondary inline-flex cursor-pointer items-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-colors"
          >
            <Camera size={14} aria-hidden="true" />
            {buttonLabel}
          </label>
          <input
            id={id}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            className="sr-only"
            onChange={(e) => onPick(e.target.files?.[0])}
          />
          <p className="text-muted-foreground mt-1.5 text-xs">
            JPG، PNG یا WEBP، تا ۲ مگابایت
          </p>
          {error && (
            <p className="text-destructive mt-1.5 flex items-center gap-1 text-xs">
              <AlertCircle size={12} aria-hidden="true" /> {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
