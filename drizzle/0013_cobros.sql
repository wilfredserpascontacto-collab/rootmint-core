-- Cobros: la plata que el cliente va entregando contra cada factura.
--
-- El saldo no se guarda en ningun lado: se calcula (total de la factura menos
-- lo cobrado). Un cobro equivocado se anula con su motivo, no se borra.

CREATE TYPE "payment_method" AS ENUM ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id"),
  "amount_cents" integer NOT NULL,
  "paid_on" timestamp with time zone DEFAULT now() NOT NULL,
  "method" "payment_method" DEFAULT 'efectivo' NOT NULL,
  "reference" text,
  "note" text,
  "annulled_at" timestamp with time zone,
  "annul_reason" text,
  "annulled_by" uuid REFERENCES "users"("id"),
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_invoice_idx" ON "payments" ("invoice_id");
