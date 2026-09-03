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
  active: boolean("active").notNull().default(true),
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
