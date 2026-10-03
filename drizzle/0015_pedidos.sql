-- Pedidos y reservas.
--
-- Un pedido es un compromiso con un cliente (la cotizacion es solo una oferta).
-- Lo facturado y la reserva vigente NO se guardan: salen de las facturas
-- emitidas que apuntan al renglon. Lo unico guardado es cuanto se aparto del
-- patio en el momento de apartar.

CREATE TYPE "sales_order_status" AS ENUM ('abierto', 'cancelado');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "number" integer NOT NULL UNIQUE,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id"),
  "customer_name" text NOT NULL,
  "quote_id" uuid REFERENCES "quotes"("id"),
  "status" "sales_order_status" DEFAULT 'abierto' NOT NULL,
  "needed_by" timestamp with time zone,
  "delivery_address" text,
  "notes" text,
  "cancelled_at" timestamp with time zone,
  "cancel_reason" text,
  "cancelled_by" uuid REFERENCES "users"("id"),
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_order_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "sales_orders"("id"),
  "catalog_item_id" uuid REFERENCES "catalog_items"("id"),
  "quote_line_id" uuid REFERENCES "quote_lines"("id"),
  "description" text NOT NULL,
  "quantity" integer NOT NULL,
  "unit_price_cents" integer NOT NULL,
  "reserved_quantity" integer DEFAULT 0 NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_order_lines_order_idx" ON "sales_order_lines" ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_orders_status_idx" ON "sales_orders" ("status");
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "sales_order_id" uuid REFERENCES "sales_orders"("id");
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "sales_order_line_id" uuid REFERENCES "sales_order_lines"("id");
