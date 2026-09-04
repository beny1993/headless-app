// The saved-address contract — DERIVED from checkout's `addressSchema`, never a
// re-declaration of it (the repo's derive-not-mirror rule). A saved address is a
// checkout delivery address plus an optional label, so `.extend` is the whole
// difference: the account book and checkout can never disagree on what an address
// is, and the checkout prefill becomes a field-for-field assignment.
//
// **Nothing here may import drizzle, `pg` or `@hono/zod-openapi`** — ships in the
// account and checkout browser bundles. Plain zod only.
import { z } from 'zod';
import { addressSchema } from '@/lib/checkout/checkout-input';
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
