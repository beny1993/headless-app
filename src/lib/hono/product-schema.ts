// The shape of a product on the wire, and the one image schema under it.
//
// Here rather than in either route module because **both** answer with a
// product: the storefront's list and detail rows extend it, and the admin
// panel's payload is the same row plus `isActive` and `updatedAt`. Written
// out twice it had already been widened twice by hand for this story — which
// is the shape of the drift the repo's derive-never-mirror rule exists to
// stop, and which the `Category` pair has already suffered on `sortOrder`.
//
// `z` from `zod`, not from `@hono/zod-openapi` — see the note in ./envelope.ts.
import { z } from 'zod';
import { PET_TYPE_VALUES } from '@/lib/catalog/product-query';

export const ProductImageSchema = z
  .object({
    id: z.uuid(),
    /**
     * A storage key, not a URL — `products/cat-toy.jpg`. Resolving it to a URL
     * is the storage interface's job, not this endpoint's.
     */
    objectKey: z.string(),
    sortOrder: z.number().int(),
  })
  .openapi('ProductImage');

export const ProductSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    slug: z.string(),
    sku: z.string(),
    brand: z.string().nullable(),
    benefit: z.string().nullable(),
    description: z.string().nullable(),
    /** Integer Toman. Never a float, never a string. */
    price: z.number().int().positive(),
    oldPrice: z.number().int().positive().nullable(),
    stock: z.number().int().nonnegative(),
    /** One pet or both, in the catalog's canonical order. Never empty. */
    petTypes: z.array(z.enum(PET_TYPE_VALUES)).min(1),
    /** The product's **main** category. */
    categoryId: z.uuid(),
    /**
     * The categories it is also filed under, in the order the admin added
     * them. Empty for most products; `categoryId` is unaffected, so a consumer
     * that ignores this field keeps working exactly as before.
     */
    extraCategoryIds: z.array(z.uuid()),
    /**
     * The product this one is a variant of — a smell, a colour, a size — or
     * `null` for a standalone product **and for a family's head**, which points
     * at nothing itself. A listing never returns a row with this set: members
     * are reached from their head's page.
     */
    variantOf: z.uuid().nullable(),
    /** «۱۰ کیلوگرم», «قرمز». Null on a product that has no siblings. */
    variantLabel: z.string().nullable(),
    createdAt: z.iso.datetime(),
    images: z.array(ProductImageSchema),
  })
  .openapi('Product');
