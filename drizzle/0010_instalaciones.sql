-- Instalaciones: lo que se dejo funcionando en un lugar.
--
-- Primer paso del modulo de servicio. Es el objeto del que despues cuelgan las
-- garantias, los planes de mantenimiento y las visitas; por eso va solo y
-- primero. No toca ninguna tabla existente: apunta a clientes y cotizaciones,
-- y nada apunta a ella todavia.

CREATE TABLE IF NOT EXISTS "installations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "number" integer NOT NULL UNIQUE,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id"),
  "quote_id" uuid REFERENCES "quotes"("id"),
  "label" text NOT NULL,
  "address" text NOT NULL,
  "description" text NOT NULL,
  "delivered_at" date,
  "notes" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "installations_customer_idx" ON "installations" ("customer_id");
