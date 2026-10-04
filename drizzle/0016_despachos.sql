DO $$ BEGIN
  CREATE TYPE "delivery_status" AS ENUM ('entregado', 'anulado');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "number" integer NOT NULL UNIQUE,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id"),
  "customer_name" text NOT NULL,
  "invoice_id" uuid REFERENCES "invoices"("id"),
  "sales_order_id" uuid REFERENCES "sales_orders"("id"),
  "status" "delivery_status" DEFAULT 'entregado' NOT NULL,
  "delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
  "received_by_name" text NOT NULL,
  "received_by_document" text,
  "address" text,
  "driver_name" text,
  "vehicle_plate" text,
  "notes" text,
  "signature" text,
  "annulled_at" timestamp with time zone,
  "annul_reason" text,
  "annulled_by" uuid REFERENCES "users"("id"),
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "delivery_id" uuid NOT NULL REFERENCES "deliveries"("id"),
  "catalog_item_id" uuid REFERENCES "catalog_items"("id"),
  "block_type_id" uuid,
  "invoice_line_id" uuid REFERENCES "invoice_lines"("id"),
  "sales_order_line_id" uuid REFERENCES "sales_order_lines"("id"),
  "description" text NOT NULL,
  "quantity" integer NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_photos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "delivery_id" uuid NOT NULL REFERENCES "deliveries"("id"),
  "data_url" text NOT NULL,
  "caption" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid REFERENCES "users"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deliveries_customer_idx" ON "deliveries" ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deliveries_invoice_idx" ON "deliveries" ("invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deliveries_order_idx" ON "deliveries" ("sales_order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deliveries_status_idx" ON "deliveries" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_lines_delivery_idx" ON "delivery_lines" ("delivery_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_lines_invoice_line_idx" ON "delivery_lines" ("invoice_line_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_photos_delivery_idx" ON "delivery_photos" ("delivery_id");
