-- Almacen de materia prima: proveedores, compras con recepcion parcial,
-- existencia por movimientos y conteo fisico.
--
-- La existencia NO se guarda: es la suma de material_moves. Pedir una compra no
-- mete nada; lo que lo mete es la recepcion. El conteo fisico congela lo que el
-- sistema creia que habia y, al aprobarse, registra solo la diferencia.
-- No se retrocede el consumo de lotes anteriores: el almacen arranca en cero y
-- se pone en su valor real con un conteo fisico.

ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "min_stock_milli" integer;
--> statement-breakpoint
CREATE TYPE "material_move_reason" AS ENUM ('compra', 'consumo', 'ajuste', 'merma', 'devolucion');
--> statement-breakpoint
CREATE TYPE "purchase_status" AS ENUM ('abierta', 'cancelada');
--> statement-breakpoint
CREATE TYPE "count_status" AS ENUM ('abierto', 'aprobado', 'cancelado');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "suppliers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "nit" text,
  "nrc" text,
  "contact_name" text,
  "phone" text,
  "email" text,
  "address" text,
  "notes" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "number" integer NOT NULL UNIQUE,
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id"),
  "ordered_on" timestamp with time zone DEFAULT now() NOT NULL,
  "document_ref" text,
  "notes" text,
  "status" "purchase_status" DEFAULT 'abierta' NOT NULL,
  "cancelled_at" timestamp with time zone,
  "cancel_reason" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "purchase_id" uuid NOT NULL REFERENCES "purchases"("id"),
  "material_id" uuid NOT NULL REFERENCES "materials"("id"),
  "description" text NOT NULL,
  "purchase_unit" text NOT NULL,
  "content_per_purchase_milli" integer NOT NULL,
  "quantity_milli" integer NOT NULL,
  "unit_cost_cents" integer NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_lines_purchase_idx" ON "purchase_lines" ("purchase_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "number" integer NOT NULL UNIQUE,
  "purchase_id" uuid NOT NULL REFERENCES "purchases"("id"),
  "received_on" timestamp with time zone DEFAULT now() NOT NULL,
  "document_ref" text,
  "notes" text,
  "annulled_at" timestamp with time zone,
  "annul_reason" text,
  "annulled_by" uuid REFERENCES "users"("id"),
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_receipts_purchase_idx" ON "purchase_receipts" ("purchase_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_receipt_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "receipt_id" uuid NOT NULL REFERENCES "purchase_receipts"("id"),
  "purchase_line_id" uuid NOT NULL REFERENCES "purchase_lines"("id"),
  "material_id" uuid NOT NULL REFERENCES "materials"("id"),
  "quantity_milli" integer NOT NULL,
  "dosing_quantity_milli" integer NOT NULL,
  "unit_cost_cents" integer NOT NULL,
  "cost_cents" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_receipt_lines_receipt_idx" ON "purchase_receipt_lines" ("receipt_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "material_moves" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "material_id" uuid NOT NULL REFERENCES "materials"("id"),
  "quantity_milli" integer NOT NULL,
  "reason" "material_move_reason" NOT NULL,
  "ref_type" text,
  "ref_id" uuid,
  "cost_cents" integer,
  "note" text,
  "noted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_moves_material_idx" ON "material_moves" ("material_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_moves_ref_idx" ON "material_moves" ("ref_type", "ref_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "material_counts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "number" integer NOT NULL UNIQUE,
  "status" "count_status" DEFAULT 'abierto' NOT NULL,
  "notes" text,
  "approved_at" timestamp with time zone,
  "approved_by" uuid REFERENCES "users"("id"),
  "cancelled_at" timestamp with time zone,
  "cancel_reason" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "material_count_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "count_id" uuid NOT NULL REFERENCES "material_counts"("id"),
  "material_id" uuid NOT NULL REFERENCES "materials"("id"),
  "description" text NOT NULL,
  "unit_abbreviation" text NOT NULL,
  "expected_milli" integer NOT NULL,
  "counted_milli" integer,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_count_lines_count_idx" ON "material_count_lines" ("count_id");
