// The saved-address contract — DERIVED from checkout's `addressSchema`, never a
// re-declaration of it (the repo's derive-not-mirror rule). A saved address is a
// checkout delivery address plus an optional label, so `.extend` is the whole
// difference: the account book and checkout can never disagree on what an address
// is, and the checkout prefill becomes a field-for-field assignment.
//
// **Nothing here may import drizzle, `pg` or `@hono/zod-openapi`** — ships in the
// account and checkout browser bundles. Plain zod only. The row type below is a
// TYPE import, which is erased; it is what lets the wire projection live here
// rather than inside the Hono route, which the account and checkout server pages
// would otherwise have to import as a value (see `pet.ts` for the same note).
import { z } from 'zod';
import type { AddressWithProvince } from '@/db/dao/AddressDao';
import { addressSchema } from '@/lib/checkout/checkout-input';
import { toAsciiDigits } from '@/lib/format';
import { STALE_PROVINCE_MESSAGE } from '@/lib/shipping/province-input';
import { optionalBoundedText } from '@/lib/validation/text';

const MAX_ADDRESS_TITLE = 60;

/**
 * The create/edit-address body: every checkout address field plus an optional
 * label («خانه» / «محل کار») the address book shows and the checkout picker uses
 * to tell saved addresses apart. Used for both create and PATCH (the form posts
 * the whole address), so the update is a full replace.
 */
export const addressInputSchema = addressSchema.extend({
  title: optionalBoundedText(MAX_ADDRESS_TITLE),
});

export type AddressInput = z.infer<typeof addressInputSchema>;

/** A postal code as stored: ASCII digits only, whatever keyboard typed it. */
export const normalizePostalCode = (value: string): string =>
  toAsciiDigits(value).replace(/\D/g, '');

/** The address fields as a form holds them: all text, the province id included. */
type AddressFormValues = Record<keyof z.infer<typeof addressSchema>, string>;

/**
 * The client gate shared by checkout and the address book: field → message.
 * Stricter than `addressSchema` on purpose; the server stays authoritative.
 */
export const validateAddress = (
  values: AddressFormValues,
  staleProvince: boolean,
) => {
  const errors: Partial<AddressFormValues> = {};
  if (!values.recipientName.trim())
    errors.recipientName = 'نام گیرنده را وارد کن.';
  if (!values.recipientPhone.trim())
    errors.recipientPhone = 'شماره تماس گیرنده را وارد کن.';
  if (!values.provinceId) errors.provinceId = 'استان را انتخاب کن.';
  else if (staleProvince) errors.provinceId = STALE_PROVINCE_MESSAGE;
  if (!values.city.trim()) errors.city = 'شهر را وارد کن.';
  if (values.addressLine.trim().length < 10)
    errors.addressLine = 'آدرس کامل را وارد کن (حداقل ۱۰ حرف).';
  if (normalizePostalCode(values.postalCode).length !== 10)
    errors.postalCode = 'کد پستی باید ۱۰ رقم باشد.';
  return errors;
};

/**
 * The saved address as it crosses the wire: the stored row plus the province
 * name it is joined to. Defined here, not in the route, so the account and
 * checkout server pages can project rows without importing the API.
 * `src/lib/hono/routes/me-addresses.ts` registers this shape under `Address`.
 *
 * Only an ORDER snapshots its province — this is editable data, so a later
 * province rename shows up here, which is correct.
 */
export const addressResponseSchema = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  recipientName: z.string(),
  recipientPhone: z.string(),
  provinceId: z.number().int().positive(),
  provinceName: z.string(),
  city: z.string(),
  postalCode: z.string(),
  addressLine: z.string(),
  createdAt: z.iso.datetime(),
});

/** The saved-address shape the account book and the checkout picker render. */
export type AddressResponse = z.infer<typeof addressResponseSchema>;

/** AddressWithProvince → the wire projection: Date to ISO, internal columns dropped. */
export const toAddressResponse = (
  row: AddressWithProvince,
): AddressResponse => ({
  id: row.id,
  title: row.title,
  recipientName: row.recipientName,
  recipientPhone: row.recipientPhone,
  provinceId: row.provinceId,
  provinceName: row.provinceName,
  city: row.city,
  postalCode: row.postalCode,
  addressLine: row.addressLine,
  createdAt: row.createdAt.toISOString(),
});
