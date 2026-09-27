'use client';

import Image from 'next/image';
import { AlertCircle, Camera } from 'lucide-react';
import { postForm } from '@/lib/api-client';
import { API_PATHS } from '@/lib/constant/paths';
import {
  ACCEPTED_IMAGE_TYPES,
  IMAGE_FIELD_NAME,
  IMAGE_FORMAT_HINT,
  IMAGE_SIZE_ERROR,
  IMAGE_TYPE_ERROR,
  MAX_UPLOAD_BYTES,
  imageUploadResultSchema,
} from '@/lib/storage/image-upload';

// The admin image slot the content editor and the category manager render.
// Presentational: it shows the current preview (a bundled/upload URL, or a
// `blob:` URL for a just-picked file), a file input, the accept/size hint, and
// an error — and calls `onPick` with the chosen file. The upload itself stays
// with the form, through `uploadImage` below. `validateImageFile` is shared with
// the product gallery field, so the Persian refusals — which come from the
// module that owns the cap they quote — live in one place.

/**
 * Upload one picked file to the shared admin image route and return its storage
 * key, for the form to save into its own body. The route writes no row: the
 * key means nothing until that save stores it.
 */
export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.set(IMAGE_FIELD_NAME, file);
  const { key } = await postForm(
    API_PATHS.ADMIN_CONTENT_IMAGES,
    form,
    imageUploadResultSchema,
  );
  return key;
}

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
  umami,
  hint,
}: {
  id: string;
  label: string;
  /** The URL to preview: an `imageSrc` result, or a `blob:` URL for a fresh pick. */
  preview: string | null;
  error?: string;
  buttonLabel: string;
  onPick: (file: File | undefined) => void;
  /** The input's `data-umami-event` — required, as every tracked control's is. */
  umami: string;
  /** What the photo is for, announced with the input rather than only shown. */
  hint?: string;
}) {
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  // Error first, as the field kit's `fieldAria` orders them.
  const describedBy =
    [error && errorId, hint && hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      {/* Identified, and pointed at from the input below. On its own this is
          just text: the only `<label htmlFor>` here wraps the BUTTON's words,
          so without `aria-labelledby` the input's accessible name is «تغییر
          تصویر» and the field's own name reaches nobody. */}
      <p id={labelId} className="mb-1.5 block text-sm font-medium">
        {label}
      </p>
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
          {/* `has-[:focus-visible]`, not `peer-focus-visible`: the input is
              `sr-only`, so the global focus outline lands on something nobody
              can see, and `peer` cannot reach backwards — the input follows
              this label in source order. */}
          <label
            htmlFor={id}
            className="border-border hover:bg-secondary has-[:focus-visible]:outline-ring inline-flex cursor-pointer items-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2"
          >
            <Camera size={14} aria-hidden="true" />
            {buttonLabel}
            <input
              id={id}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              className="sr-only"
              aria-labelledby={labelId}
              // Announced rather than only shown: without these a refused file
              // leaves a red line on screen and nothing at all for a screen
              // reader following the input.
              aria-describedby={describedBy}
              aria-invalid={error ? true : undefined}
              data-umami-event={umami}
              onChange={(e) => {
                onPick(e.target.files?.[0]);
                // Emptied, so picking the same file again — after the form
                // dropped it — is a change the input still reports.
                e.target.value = '';
              }}
            />
          </label>
          <p className="text-muted-foreground mt-1.5 text-xs">
            {IMAGE_FORMAT_HINT}
          </p>
          {hint && (
            <p id={hintId} className="text-muted-foreground mt-1.5 text-xs">
              {hint}
            </p>
          )}
          {error && (
            <p
              id={errorId}
              className="text-destructive mt-1.5 flex items-center gap-1 text-xs"
            >
              <AlertCircle size={12} aria-hidden="true" /> {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
