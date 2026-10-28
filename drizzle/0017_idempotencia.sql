-- El recibo del guardado: qué documento salió de cada intento.
--
-- Quien guarda manda una llave y la repite si reintenta. Si la llave vuelve,
-- acá está anotado qué se creó la primera vez y se devuelve eso. Sin esto, un
-- doble clic son dos cotizaciones, o dos créditos fiscales con números
-- corridos por una sola venta.
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "key" text PRIMARY KEY NOT NULL,
  "scope" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
