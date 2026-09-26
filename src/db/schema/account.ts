// A customer's personal data: their pet profiles and their saved address book.
// Both are owned by this story's two migrations.
//
// Unlike orders (financial records that snapshot everything and never
// hard-delete), pets and addresses are live, editable, personal data with no
// downstream dependents — an order keeps its OWN address snapshot, so deleting a
// saved address never touches order history. Hence `onDelete: 'cascade'` from the
// user (a deleted account takes its pets and addresses with it) and a real
// hard-delete path in the DAOs.
//
// House rules, the same the rest of the schema obeys:
//   · Every timestamp is `timestamptz` (`{ withTimezone: true }`).
//   · The `pet_type` / `pet_gender` pgEnums are built from the constants in
//     `@/lib/catalog/product-query` and `@/lib/account/pet`, so the database's
//     domain and the client's (the account form) are one definition. `pet_type`
//     is REUSED from the catalog (`petTypeEnum`) — a pet's species is the same
//     cat/dog domain a product's is, so there is one enum, not two.
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from '@/db/schema/columns';
import { PET_GENDER_VALUES } from '@/lib/account/pet';
import { users } from '@/db/schema/auth';
import { petTypeEnum } from '@/db/schema/catalog';
import { provinces } from '@/db/schema/shipping';

export const petGenderEnum = pgEnum('pet_gender', PET_GENDER_VALUES);

export const pets = pgTable(
  'pets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * The owner. `cascade`: a pet is personal data with no history to preserve,
     * so it dies with the account. Every read and write is scoped by this column
     * (`PetDao`) — the IDOR defence lives in the `WHERE`, never in the URL.
     */
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** cat/dog — the catalog's `pet_type` enum, reused. */
    type: petTypeEnum('type').notNull(),
    gender: petGenderEnum('gender').notNull(),
    neutered: boolean('neutered').default(false).notNull(),
    /**
     * Free text, nullable: the design stores age and weight with Persian units
     * («۳ سال» / «۴ کیلو»), so no numeric unit is imposed. Breed is likewise
     * optional free text.
     */
    breed: text('breed'),
    age: text('age'),
    weight: text('weight'),
    /**
     * An optional photo URL. User-supplied and later rendered, so it is
     * attacker-controllable — the API validates it as an `https:` URL
     * (`optionalHttpsUrl`) and the UI renders it defensively. No file upload: the
     * local storage seam does not exist yet, so a validated URL is the whole
     * feature (per the story's data-model note).
     */
    photoUrl: text('photo_url'),
    createdAt,
    updatedAt,
  },
  (table) => [index('pets_user_id_idx').on(table.userId)],
);

export const addresses = pgTable(
  'addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The owner. `cascade`, and every read/write scoped by it — see `pets`. */
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Optional label the book shows and the checkout picker uses («خانه»). */
    title: text('title'),
    recipientName: text('recipient_name').notNull(),
    recipientPhone: text('recipient_phone').notNull(),
    /**
     * The province. `restrict`: provinces are reference data nothing hard-deletes,
     * matching `orders.province_id` / `shipping_rates.province_id`. NOT NULL here
     * (unlike `orders`, which relies on its `province_name` snapshot) — a saved
     * address is live data read back through a join, so it always names a real
     * province.
     */
    provinceId: integer('province_id')
      .notNull()
      .references(() => provinces.id, { onDelete: 'restrict' }),
    city: text('city').notNull(),
    postalCode: text('postal_code').notNull(),
    addressLine: text('address_line').notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [index('addresses_user_id_idx').on(table.userId)],
);

export type Pet = typeof pets.$inferSelect;
export type Address = typeof addresses.$inferSelect;
