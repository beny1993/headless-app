ALTER TYPE "public"."order_status" ADD VALUE 'awaiting_receipt' BEFORE 'paid';--> statement-breakpoint
CREATE TABLE "payment_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_receipts_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "payment_receipts_size_bounds" CHECK ("payment_receipts"."size" > 0 AND "payment_receipts"."size" <= 5242880)
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_receipts_order_id_idx" ON "payment_receipts" USING btree ("order_id");