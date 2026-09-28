-- La orden de produccion: el papel que le dice al maquinista que fabricar.
--
-- Hasta aca la cotizacion sabia cuanto faltaba producir, pero no habia forma
-- de que ese numero bajara a la planta. Lo que llegaba era un mensaje de
-- WhatsApp.

CREATE TYPE "production_order_status" AS ENUM ('pendiente', 'en_proceso', 'terminada', 'anulada');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "number" integer NOT NULL UNIQUE,
  "quote_id" uuid,
  "customer_name" text,
  "status" "production_order_status" DEFAULT 'pendiente' NOT NULL,
  "needed_by" timestamp with time zone,
  "notes" text,
  "closed_at" timestamp with time zone,
  "closed_by" uuid REFERENCES "users"("id"),
  "close_reason" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_orders_status_idx" ON "production_orders" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_orders_quote_idx" ON "production_orders" ("quote_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_order_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "production_orders"("id"),
  "block_type_id" uuid NOT NULL REFERENCES "block_types"("id"),
  "description" text NOT NULL,
  "quantity" integer NOT NULL,
  "quote_line_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_order_lines_order_idx" ON "production_order_lines" ("order_id");
--> statement-breakpoint
-- Los lotes ya corridos se quedan sin orden, y esta bien: se corrieron sin
-- que existiera ninguna. Inventarles una seria mentir sobre el pasado.
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "production_order_id" uuid REFERENCES "production_orders"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "batches_production_order_idx" ON "batches" ("production_order_id");
