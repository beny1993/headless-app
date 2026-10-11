CREATE TYPE "public"."delivery_method" AS ENUM('post', 'courier');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_method" "delivery_method" DEFAULT 'post' NOT NULL;