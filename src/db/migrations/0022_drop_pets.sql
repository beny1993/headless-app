ALTER TABLE "pets" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "pets" CASCADE;--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_pet_type_not_empty";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "pet_type";--> statement-breakpoint
DROP TYPE "public"."pet_gender";--> statement-breakpoint
DROP TYPE "public"."pet_type";