-- Garantias: el plazo en que volver es gratis.
--
-- Paso 2 del modulo de servicio. Cada garantia lleva SU fecha de inicio y SU
-- fin —a unos clientes se les da 6 meses y a otros un año—, y los cuatro
-- textos que exige el Art. 33 de la Ley de Proteccion al Consumidor. Nada de
-- «en garantia / vencida» se guarda: se calcula de las fechas y de hoy.

CREATE TYPE "warranty_origin" AS ENUM ('legal', 'extension');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warranties" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "installation_id" uuid NOT NULL REFERENCES "installations"("id"),
  "origin" "warranty_origin" DEFAULT 'legal' NOT NULL,
  "starts_at" date NOT NULL,
  "ends_at" date NOT NULL,
  "price_cents" integer DEFAULT 0 NOT NULL,
  "sold_at" timestamp with time zone,
  "sold_by" uuid REFERENCES "users"("id"),
  "annulled_at" timestamp with time zone,
  "annulled_by" uuid REFERENCES "users"("id"),
  "annul_reason" text,
  "conditions" text DEFAULT '' NOT NULL,
  "customer_duties" text DEFAULT '' NOT NULL,
  "how_to_claim" text DEFAULT '' NOT NULL,
  "issued_by" text DEFAULT '' NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "warranties_dates_check" CHECK ("ends_at" >= "starts_at")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warranties_installation_idx" ON "warranties" ("installation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warranties_ends_idx" ON "warranties" ("ends_at");
