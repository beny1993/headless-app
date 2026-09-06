CREATE TYPE "public"."discount_type" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TABLE "discount_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"type" "discount_type" NOT NULL,
	"value" bigint NOT NULL,
	"expires_at" timestamp with time zone,
	"usage_limit" integer,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"min_order_amount" bigint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_codes_code_unique" UNIQUE("code"),
	CONSTRAINT "discount_codes_value_valid" CHECK (("discount_codes"."type" = 'percent' AND "discount_codes"."value" >= 1 AND "discount_codes"."value" <= 100) OR ("discount_codes"."type" = 'fixed' AND "discount_codes"."value" > 0)),
	CONSTRAINT "discount_codes_usage_count_non_negative" CHECK ("discount_codes"."usage_count" >= 0),
	CONSTRAINT "discount_codes_usage_limit_positive" CHECK ("discount_codes"."usage_limit" IS NULL OR "discount_codes"."usage_limit" > 0),
	CONSTRAINT "discount_codes_min_order_non_negative" CHECK ("discount_codes"."min_order_amount" >= 0)
);
