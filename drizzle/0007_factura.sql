-- La factura: donde la cotizacion se vuelve una deuda que alguien tiene que
-- pagar. Dos tipos, porque en El Salvador hay dos y no se diferencian solo en
-- el nombre: al credito fiscal se le desglosa el IVA, al consumidor final se
-- le incluye en el precio, y cada uno lleva su propia serie de numeros.

CREATE TYPE "invoice_kind" AS ENUM ('ccf', 'final');
--> statement-breakpoint
CREATE TYPE "invoice_status" AS ENUM ('issued', 'annulled');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_snapshot" jsonb,
  "business_snapshot" jsonb,
  "kind" "invoice_kind" NOT NULL,
  "number" integer NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id"),
  "quote_id" uuid REFERENCES "quotes"("id"),
  "issue_date" timestamp with time zone NOT NULL,
  "status" "invoice_status" DEFAULT 'issued' NOT NULL,
  "subtotal_cents" integer DEFAULT 0 NOT NULL,
  "tax_cents" integer DEFAULT 0 NOT NULL,
  "total_cents" integer DEFAULT 0 NOT NULL,
  "tax_rate_milli" integer DEFAULT 0 NOT NULL,
  "notes" text,
  "annulled_at" timestamp with time zone,
  "annul_reason" text,
  "annulled_by" uuid REFERENCES "users"("id"),
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "invoices_kind_number_unique" UNIQUE ("kind", "number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id"),
  "catalog_item_id" uuid REFERENCES "catalog_items"("id"),
  "quote_line_id" uuid REFERENCES "quote_lines"("id"),
  "description" text NOT NULL,
  "quantity" integer NOT NULL,
  "unit_price_cents" integer NOT NULL,
  "subtotal_cents" integer NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
-- Las dos preguntas que se hacen todo el tiempo: las facturas de un cliente,
-- y que se facturo de una cotizacion.
CREATE INDEX IF NOT EXISTS "invoices_customer_idx" ON "invoices" ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_quote_idx" ON "invoices" ("quote_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_lines_invoice_idx" ON "invoice_lines" ("invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_lines_quote_line_idx" ON "invoice_lines" ("quote_line_id");
