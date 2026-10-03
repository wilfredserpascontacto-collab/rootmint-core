-- El NRC de la empresa que factura.
--
-- Un credito fiscal lleva el NRC de quien lo emite; el cliente lo necesita para
-- descontarse el IVA. Hasta aca solo se guardaba el NIT. Las facturas ya
-- emitidas no cambian: guardan una copia de los datos de la empresa de ese dia.

ALTER TABLE "business_profile" ADD COLUMN IF NOT EXISTS "nrc" text DEFAULT '' NOT NULL;
