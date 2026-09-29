-- Custom data migration: blank the name of every account whose name is its own
-- phone number. Until this release the OTP sign-up stored `toLocalIranPhone` as
-- the name (`getTempName`), and so did `pnpm create-admin` without a name — and
-- checkout prefills the recipient name from it, so shoppers found «۰۹۱۲…» where
-- their name belonged. New accounts now start with ''.
--
-- Only an exact match of the account's OWN number in `09…` form is cleared: a
-- name the shopper typed, or a row with no phone, is untouched. Pinned by
-- src/lib/auth/phone-name-migration.integration.test.ts.
UPDATE "user"
SET "name" = '', "updated_at" = now()
WHERE "phone_number" LIKE '+98%'
  AND "name" = '0' || substr("phone_number", 4);
