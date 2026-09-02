CREATE TABLE "otp_send_log" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_number_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "otp_send_log_phone_sent_at_idx" ON "otp_send_log" USING btree ("phone","sent_at");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_phone_number_unique" UNIQUE("phone_number");