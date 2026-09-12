CREATE TABLE IF NOT EXISTS "business_profile" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"nit" text DEFAULT '' NOT NULL,
	"terms" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "stage" text DEFAULT 'customer' NOT NULL;
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "customer_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "business_snapshot" jsonb;