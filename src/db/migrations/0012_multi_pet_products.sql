-- HAND-EDITED, like 0011 — regenerating will not reproduce this file.
--
-- drizzle-kit's generated `USING` cannot convert a populated enum column to its
-- array type: it emits a plain cast, which Postgres refuses on any row that
-- already has a value. `ARRAY["pet_type"]` replaces it, wrapping each existing
-- value as a one-element array — «cat» becomes «{cat}».
--
-- So the next change to `pet_type` cannot follow AGENTS.md's «generate + review»
-- literally: on an empty dev database the generated clause happens to work and
-- the migration then fails in production on the populated table. This is also
-- the one migration in its release that a rollback has to undo by hand — see
-- docs/DEPLOY.md, «Going back».
ALTER TABLE "products" ALTER COLUMN "pet_type" SET DATA TYPE "public"."pet_type"[] USING ARRAY["pet_type"];--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_pet_type_not_empty" CHECK (cardinality("products"."pet_type") >= 1);