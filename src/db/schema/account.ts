// A customer's personal data: their saved address book.
//
// Unlike orders (financial records that snapshot everything and never
// hard-delete), addresses are live, editable, personal data with no downstream
// dependents — an order keeps its OWN address snapshot, so deleting a saved
// address never touches order history. Hence `onDelete: 'cascade'` from the
// user (a deleted account takes its addresses with it) and a real hard-delete
// path in the DAO.
//
// House rule, the same the rest of the schema obeys: every timestamp is
// `timestamptz` (`{ withTimezone: true }`).
import { index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from '@/db/schema/columns';
import { users } from '@/db/schema/auth';
import { provinces } from '@/db/schema/shipping';

export const addresses = pgTable(
  'addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * The owner. `cascade`: personal data with no history to preserve, so it
     * dies with the account. Every read and write is scoped by this column
     * (`AddressDao`) — the IDOR defence lives in the `WHERE`, never in the URL.
     */
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

export type Address = typeof addresses.$inferSelect;
