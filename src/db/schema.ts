import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

// --- Enums -------------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", ["owner", "staff", "viewer"]);

export const customerTypeEnum = pgEnum("customer_type", ["person", "company"]);

export const catalogItemTypeEnum = pgEnum("catalog_item_type", [
  "service",
  "product",
]);

export const quoteStatusEnum = pgEnum("quote_status", [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
]);

// --- Shared column groups ------------------------------------------------

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

// --- Correlativos ----------------------------------------------------------
// Un contador por tipo de documento (hoy solo "quote"; "01", "03", etc. de
// fiscal_documents se agregan igual más adelante). Se incrementa con
// UPDATE ... RETURNING dentro de la misma transacción que crea el
// documento, nunca con MAX() + 1 fuera de transacción.

export const counters = pgTable("counters", {
  id: text("id").primaryKey(),
  value: integer("value").notNull().default(0),
});

// --- Identidad y acceso ----------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("staff"),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

// --- El cliente del cliente ------------------------------------------------

export const customers = pgTable("customers", {
  stage: text("stage").notNull().default("customer"),
  id: uuid("id").primaryKey().defaultRandom(),
  type: customerTypeEnum("type").notNull(),
  name: text("name").notNull(),
  nit: text("nit"),
  nrc: text("nrc"),
  giro: text("giro"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  municipality: text("municipality"),
  department: text("department"),
  notes: text("notes"),
  /**
   * Hasta cuánto se le fía y a cuántos días. Los dos pueden quedar en nulo, y
   * nulo no es cero: cero sería «no se le fía nada», nulo es «todavía no se ha
   * hablado». La diferencia importa porque el sistema avisa sobre el tope, y
   * no tiene nada que avisar sobre un tope que nadie definió.
   *
   * El plazo es un número libre de días, no una lista de opciones: el día que
   * pacten 45 con alguien, 45 tiene que caber.
   */
  creditLimitCents: integer("credit_limit_cents"),
  creditTermDays: integer("credit_term_days"),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
});

/**
 * El precio que se le respeta a un cliente, distinto al del catálogo.
 *
 * `catalogItemId` puede ir en nulo a propósito: así cabe un precio acordado
 * sobre algo que todavía no está en el catálogo, escrito con las palabras de
 * la persona. Solo los que apuntan a un producto se aplican solos al cotizar;
 * los sueltos quedan como referencia, que es mejor que no tener dónde
 * escribirlos.
 */
export const customerPrices = pgTable("customer_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  catalogItemId: uuid("catalog_item_id").references(() => catalogItems.id),
  description: text("description").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  unit: text("unit"),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
});

/**
 * Lo que pasa con la plata de un cliente, anotado con fecha.
 *
 * «12 sept · pidió prórroga hasta fin de mes». No reemplaza al saldo —el saldo
 * se calcula, no se escribe— sino a la libreta donde hoy esas cosas no se
 * anotan en ningún lado. La fecha viene puesta pero se puede cambiar: a veces
 * uno registra el jueves lo que pasó el martes.
 */
export const customerMoneyNotes = pgTable("customer_money_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  notedOn: timestamp("noted_on", { withTimezone: true }).notNull().defaultNow(),
  body: text("body").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
});

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  name: text("name").notNull(),
  position: text("position"),
  phone: text("phone"),
  email: text("email"),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
});

// --- El catálogo -------------------------------------------------------

export const catalogItems = pgTable("catalog_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  type: catalogItemTypeEnum("type").notNull(),
  unit: text("unit").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  category: text("category"),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
});

// --- Cotización ----------------------------------------------------------

export const quotes = pgTable("quotes", {
  customerSnapshot: jsonb("customer_snapshot"),
  businessSnapshot: jsonb("business_snapshot"),
  id: uuid("id").primaryKey().defaultRandom(),
  number: integer("number").notNull().unique(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  workLocation: text("work_location"),
  description: text("description"),
  issueDate: timestamp("issue_date", { withTimezone: true }).notNull(),
  validityDays: integer("validity_days").notNull().default(15),
  status: quoteStatusEnum("status").notNull().default("draft"),
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  /**
   * La tasa con la que se calculó el impuesto, en milésimas de punto
   * porcentual: 13% se guarda como 13000.
   *
   * Antes solo se guardaba el monto. Con el monto solo no se puede recalcular
   * nada al corregir una cotización —habría que deducir la tasa dividiendo, y
   * la división arrastra el redondeo—, ni saber con qué tasa se emitió un
   * documento viejo si el día de mañana el IVA cambia. La tasa es parte de lo
   * que se congela, igual que el precio de cada renglón.
   */
  taxRateMilli: integer("tax_rate_milli").notNull().default(0),
  notes: text("notes"),
  terms: text("terms"),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
});

export const quoteLines = pgTable("quote_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: uuid("quote_id")
    .notNull()
    .references(() => quotes.id),
  catalogItemId: uuid("catalog_item_id").references(() => catalogItems.id),
  // Congelados al momento de crear la línea: la verdad de esta cotización
  // para siempre, independiente de lo que pase luego en el catálogo.
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  subtotalCents: integer("subtotal_cents").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  ...timestamps,
});

// --- Rastro ----------------------------------------------------------------

export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  entity: text("entity").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  oldValues: jsonb("old_values"),
  newValues: jsonb("new_values"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const businessProfile = pgTable("business_profile", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  nit: text("nit").notNull().default(""),
  terms: text("terms").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
