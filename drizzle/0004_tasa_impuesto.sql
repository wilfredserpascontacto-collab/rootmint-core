ALTER TABLE "quotes" ADD COLUMN "tax_rate_milli" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Las cotizaciones que ya existen no traen la tasa: se deduce del monto que sí
-- quedó guardado. impuesto = subtotal × tasa ÷ 100, así que la tasa en
-- milésimas de punto es impuesto × 100000 ÷ subtotal. Sale exacta en el caso
-- normal (25350 × 100000 ÷ 195000 = 13000) y redondeada al milésimo cuando el
-- monto original venía de una tasa rara. Las de subtotal cero se quedan en 0,
-- que es lo que son.
UPDATE "quotes"
   SET "tax_rate_milli" = ROUND("tax_cents"::numeric * 100000 / "subtotal_cents")
 WHERE "subtotal_cents" > 0;
