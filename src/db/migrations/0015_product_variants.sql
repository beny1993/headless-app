ALTER TABLE "products" ADD COLUMN "variant_of" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "variant_label" text;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_variant_of_products_id_fk" FOREIGN KEY ("variant_of") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_variant_of_idx" ON "products" USING btree ("variant_of");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_variant_not_self" CHECK ("products"."variant_of" <> "products"."id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_variant_label_present" CHECK ("products"."variant_of" is null or length(btrim("products"."variant_label")) > 0);