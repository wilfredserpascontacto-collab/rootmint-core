-- El inventario de producto terminado, y el puente que faltaba entre lo que se
-- vende y lo que se fabrica.
--
-- Hasta aca "Bloque 15x20x40" existia dos veces —una en el catalogo comercial
-- y otra en los tipos de bloque de produccion— sin nada que dijera que eran el
-- mismo. Por eso el sistema no podia saber si lo que un cliente pide ya esta
-- hecho.

ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "block_type_id" uuid;
--> statement-breakpoint
CREATE TYPE "inventory_reason" AS ENUM ('produccion', 'venta', 'ajuste', 'rotura', 'devolucion');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_moves" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "block_type_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "reason" "inventory_reason" NOT NULL,
  "ref_type" text,
  "ref_id" uuid,
  "note" text,
  "noted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_moves_block_type_idx" ON "inventory_moves" ("block_type_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_moves_ref_idx" ON "inventory_moves" ("ref_type", "ref_id");
--> statement-breakpoint
-- Lo ya producido entra al inventario, para no arrancar en cero fingiendo que
-- la planta nunca fabrico nada. Es la unica fuente que tenemos: si la
-- existencia real es otra —porque se vendio por fuera del sistema, o se
-- rompio— se corrige con un movimiento de ajuste, que es justamente para eso.
INSERT INTO "inventory_moves" ("block_type_id", "quantity", "reason", "ref_type", "ref_id", "note", "noted_at")
SELECT "block_type_id", "blocks_good", 'produccion', 'batch', "id",
       'Entrada inicial: lote ya producido antes de que existiera el inventario.',
       "produced_at"
  FROM "batches"
 WHERE "blocks_good" > 0;
