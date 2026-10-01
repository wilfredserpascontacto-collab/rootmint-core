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

import { pgTable, pgEnum, uuid, text, integer, date, timestamp, index } from "drizzle-orm/pg-core";
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

/**
 * De donde viene una garantia: la del trabajo, o una extension que se vendio
 * encima. Van en la misma tabla porque son lo mismo —un plazo en que se vuelve
 * gratis—; lo que cambia es el precio y quien la pudo dar.
 */
export const warrantyOriginEnum = pgEnum("warranty_origin", ["legal", "extension"]);

/**
 * Una garantia sobre una instalacion.
 *
 * Una instalacion puede tener varias: la del trabajo y, mas adelante, las
 * extensiones. Cada una trae SUS fechas y SUS textos, escritos en la propia
 * fila y no leidos de una plantilla: lo que se prometio el dia que se dio no
 * cambia porque el año que viene se escriban otras condiciones.
 *
 * La duracion no es fija: a unos clientes se les da 6 meses y a otros un año,
 * asi que cada garantia lleva su propio fin. «En garantia», «vencida» y
 * «cuantos dias quedan» no se guardan: se calculan de estas fechas y de hoy
 * (ver servicio/garantia.ts).
 *
 * Una garantia se puede corregir —queda en el registro de actividad— y nunca
 * se borra: se ANULA, con motivo.
 */
export const warranties = pgTable(
  "warranties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => installations.id),
    origin: warrantyOriginEnum("origin").notNull().default("legal"),

    /** Primer dia que cubre. Es un DIA (date), como la entrega: ver installations.deliveredAt. */
    startsAt: date("starts_at", { mode: "string" }).notNull(),
    /** Ultimo dia que cubre, inclusive. */
    endsAt: date("ends_at", { mode: "string" }).notNull(),

    /** Cero en la del trabajo; lo cobrado en una extension. */
    priceCents: integer("price_cents").notNull().default(0),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    soldBy: uuid("sold_by").references(() => users.id),

    annulledAt: timestamp("annulled_at", { withTimezone: true }),
    annulledBy: uuid("annulled_by").references(() => users.id),
    annulReason: text("annul_reason"),

    /**
     * Los cuatro textos que el Art. 33 de la Ley de Proteccion al Consumidor
     * exige en el documento de garantia. Pueden quedar vacios al cargarla, pero
     * entonces el certificado NO cumple la ley y el sistema lo dice.
     */
    conditions: text("conditions").notNull().default(""),
    customerDuties: text("customer_duties").notNull().default(""),
    howToClaim: text("how_to_claim").notNull().default(""),
    issuedBy: text("issued_by").notNull().default(""),

    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    porInstalacion: index("warranties_installation_idx").on(t.installationId),
    porFin: index("warranties_ends_idx").on(t.endsAt),
  }),
);
