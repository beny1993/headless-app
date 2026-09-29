// The pet-profile contract — one client-safe definition the authed API and the
// account UI share, like `@/lib/checkout/checkout-input`. The pet-gender pgEnum in
// `src/db/schema/account.ts` is built from `PET_GENDER_VALUES` here, so the
// database's domain and the client's never drift (the pattern `order-status.ts`
// uses for order status).
//
// **Nothing here may import drizzle, `pg` or `@hono/zod-openapi`** — this ships in
// the browser bundle with the account form. Plain zod only. The `Pet` row below
// is a TYPE import, which is erased, and it is what lets the wire projection
// live here instead of inside the Hono route: the account server page imports
// the projector as a value, and a value import of a route file drags
// `@hono/zod-openapi` into the RSC graph for one pure function.
//
// `type` reuses the catalog's cat/dog `PET_TYPES` (a pet's species is the same
// domain a product's `petType` is), so there is one cat/dog vocabulary sitewide.
import { z } from 'zod';
import type { Pet } from '@/db/schema/account';
import { PET_TYPES } from '@/lib/catalog/product-query';
import { boundedText, optionalBoundedText } from '@/lib/validation/text';

const MAX_PET_NAME = 100;
const MAX_PET_BREED = 100;
const MAX_PET_AGE = 40;
const MAX_PET_WEIGHT = 40;
/** A generous URL cap — long enough for any real photo URL, short enough to bound the column. */
const MAX_PHOTO_URL = 2048;

/** The `pets.gender` domain. Never compare against bare strings. */
export const PET_GENDERS = {
  MALE: 'male',
  FEMALE: 'female',
} as const;

export type PetGender = (typeof PET_GENDERS)[keyof typeof PET_GENDERS];

/** Non-empty tuple for `pgEnum` (in the schema) and `z.enum` (below). */
export const PET_GENDER_VALUES = Object.values(PET_GENDERS) as [
  PetGender,
  ...PetGender[],
];

/** cat/dog, reusing the catalog's tuple so the species vocabulary is one thing. */
const PET_KIND_VALUES = [PET_TYPES.CAT, PET_TYPES.DOG] as const;

const petKindSchema = z.enum(PET_KIND_VALUES);
const petGenderSchema = z.enum(PET_GENDER_VALUES);

/**
 * A render-time guard for a stored photo URL: `true` only for a real `https:` URL.
 * The API already rejects a non-https URL on write, so this is defence in depth —
 * a row that predates the check, or one written by any future path, still cannot
 * render a `javascript:`/`data:` src. Parsed with `new URL()`, not a prefix test.
 */
export const isHttpsUrl = (
  value: string | null | undefined,
): value is string => {
  if (!value) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * A user-supplied photo URL, or `undefined`. Requires an `https:` URL — the
 * carried-in security constraint: a pet photo is attacker-controllable (a user
 * stores it on their own row) and is later rendered, so a `javascript:` or `data:`
 * scheme must never survive validation. Parsed with `new URL()`, not a regex, so
 * the scheme check is real; an empty/cleared field collapses to `undefined`.
 */
export const optionalHttpsUrl = z
  .string()
  .trim()
  .max(MAX_PHOTO_URL, { error: 'نشانی تصویر بیش از حد طولانی است.' })
  .refine(
    (value) => {
      if (value === '') return true;
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    },
    { error: 'نشانی تصویر باید با https:// شروع شود.' },
  )
  .transform((value) => (value === '' ? undefined : value))
  .optional();

/**
 * The create/edit-pet body. `name` is the one required field (the design's only
 * validated field); `breed`, `age` and `weight` are optional free text (the design
 * stores them with Persian units, e.g. «۳ سال» / «۴ کیلو», so no unit is imposed);
 * `neutered` is always sent by the form. Used for both create and PATCH (the form
 * posts the whole pet), so the update is a full replace.
 */
export const petInputSchema = z.object({
  name: boundedText(MAX_PET_NAME),
  type: petKindSchema,
  gender: petGenderSchema,
  neutered: z.boolean(),
  breed: optionalBoundedText(MAX_PET_BREED),
  age: optionalBoundedText(MAX_PET_AGE),
  weight: optionalBoundedText(MAX_PET_WEIGHT),
  photoUrl: optionalHttpsUrl,
});

export type PetInput = z.infer<typeof petInputSchema>;

/**
 * The pet resource as it crosses the wire. Defined here, not in the route, so
 * the server page that renders the first paint can project rows without
 * importing the API. `GET/POST /api/me/pets` documents this very shape — see
 * `src/lib/hono/routes/me-pets.ts`, which registers it under `Pet`.
 */
export const petResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: petKindSchema,
  gender: petGenderSchema,
  neutered: z.boolean(),
  breed: z.string().nullable(),
  age: z.string().nullable(),
  weight: z.string().nullable(),
  photoUrl: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

/** The pet shape the account UI renders. Import, don't restate. */
export type PetResponse = z.infer<typeof petResponseSchema>;

/** Pet row → the wire projection: Date to ISO, internal `userId`/`updatedAt` dropped. */
export const toPetResponse = (row: Pet): PetResponse => ({
  id: row.id,
  name: row.name,
  type: row.type,
  gender: row.gender,
  neutered: row.neutered,
  breed: row.breed,
  age: row.age,
  weight: row.weight,
  photoUrl: row.photoUrl,
  createdAt: row.createdAt.toISOString(),
});
