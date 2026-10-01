/**
 * Modulo de servicio: lo que se instalo, y lo que se le debe a quien lo tiene.
 *
 * Cuelga del nucleo (users, customers, quotes) sin tocarlo, como el modulo de
 * bloques. El diseno completo —instalaciones, garantias, planes de
 * mantenimiento, visitas— esta en el documento «Mini ERP para Grupo Fenix»;
 * aca solo va lo que ya se construyo, paso a paso.
 *
 * Las mismas convenciones del nucleo:
 *  - Todo monto es un entero de CENTAVOS.
 *  - Nada se borra de verdad: deletedAt.
 *  - Lo que se puede calcular, no se guarda.
 */

import { pgTable, uuid, text, integer, date, timestamp, index } from "drizzle-orm/pg-core";
import { users, customers, quotes } from "./schema.js";

/**
 * Una instalacion: algo que se dejo funcionando en un lugar, y que sigue ahi
 * mucho despues de que el trabajo se cobro.
 *
 * Es el centro del sistema porque la pregunta de fondo —«¿a quien le debo
 * visita?», «¿esta llamada la cobro?»— no se le hace a un proyecto archivado
 * sino a un tablero que sigue en la pared de una casa. Un cliente puede tener
 * varias; un trabajo, una.
 */
export const installations = pgTable(
  "installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** El numero que se dice por telefono. Mismo correlativo atomico que cotizaciones. */
    number: integer("number").notNull().unique(),

    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),

    /**
     * De que cotizacion salio, si salio de una. Vacio es legitimo y frecuente:
     * un trabajo de emergencia nunca se cotizo, y un despliegue puede no tener
     * cotizaciones encendidas.
     */
    quoteId: uuid("quote_id").references(() => quotes.id),

    /** Como le dice el cliente: «la casa de la playa», «el taller». Por esto va a preguntar. */
    label: text("label").notNull(),

    /** Donde esta. Un cliente puede tener varias direcciones; cada instalacion, una. */
    address: text("address").notNull(),

    /** Que se instalo, con las palabras de quien fue. */
    description: text("description").notNull(),

    /**
     * Cuando se entrego: de aca arranca la garantia.
     *
     * Es un DIA, no un instante, y por eso es `date` y no `timestamp`: una
     * hora con zona horaria dejaria una entrega de las 9 de la noche en
     * El Salvador anotada al dia siguiente, y la garantia empezaria un dia
     * tarde en silencio.
     *
     * Nulo significa «todavia no se entrega» o «nadie cargo la fecha», que no
     * es lo mismo que «se entrego hoy»: el sistema tiene que poder decir que
     * no lo sabe en vez de inventar un dia.
     */
    deliveredAt: date("delivered_at", { mode: "string" }),

    notes: text("notes"),

    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({ porCliente: index("installations_customer_idx").on(t.customerId) }),
);
