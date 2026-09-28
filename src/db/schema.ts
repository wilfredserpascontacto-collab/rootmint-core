import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";

// --- Enums -------------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", ["owner", "staff", "viewer"]);

export const customerTypeEnum = pgEnum("customer_type", ["person", "company"]);

export const catalogItemTypeEnum = pgEnum("catalog_item_type", [
  "service",
  "product",
]);

/**
 * Los dos documentos de cobro que existen en El Salvador.
 *
 * No es una diferencia de nombre. Al comprobante de credito fiscal se le
 * desglosa el IVA aparte del precio, y va para quien presenta su NRC —una
 * constructora que quiere su credito—. La factura de consumidor final lleva
 * el IVA ya incluido en el precio, y va para una persona natural o para quien
 * no da NRC. Cada tipo lleva su propia serie de numeros.
 *
 * Los codigos "03" y "01" son los que usa Hacienda para estos documentos; se
 * dejan escritos aca porque el dia que se conecte la factura electronica van
 * a hacer falta tal cual.
 */
export const invoiceKindEnum = pgEnum("invoice_kind", ["ccf", "final"]);

/**
 * Una factura emitida no se corrige: se anula y se hace otra.
 *
 * Es lo que va a exigir la factura electronica, y es lo unico honesto cuando
 * el cliente ya tiene el papel en la mano: si el total cambiara despues, el
 * papel y el sistema dirian cosas distintas y nadie se enteraria.
 */
export const invoiceStatusEnum = pgEnum("invoice_status", ["issued", "annulled"]);

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
  /**
   * PIN corto para entrar desde la planta, cifrado igual que la contraseña.
   *
   * En la planta hay una tablet que pasa de mano en mano y manos que vienen
   * de la mezcladora. Escribir un correo y una contraseña ahí no es una
   * molestia menor: es la razón por la que la gente termina dejando la sesión
   * de otro abierta. Quien tiene PIN entra tocando su nombre y cuatro
   * dígitos. Nulo en quien no trabaja en planta.
   */
  pinHash: text("pin_hash"),
  /**
   * Intentos fallidos seguidos, y hasta cuándo está trabado.
   *
   * Un PIN de cuatro dígitos son diez mil combinaciones: a mano no se
   * adivina, pero un programa las prueba todas en un rato. Tras varios
   * fallos la cuenta se traba unos minutos, que es lo que vuelve inútil
   * probar a ciegas sin castigar a quien simplemente se equivocó.
   */
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  ...timestamps,
});

/**
 * Sesiones abiertas.
 *
 * Se decidió que la sesión dure hasta que la persona cierre: Amada y María Paz
 * entran desde su teléfono y volver a teclear la contraseña cada mañana es la
 * clase de fricción que hace que un sistema se abandone. La contrapartida es
 * que una sesión olvidada en un aparato ajeno queda viva, y por eso existe
 * esta tabla en vez de un token que el servidor no puede desdecir: aquí una
 * sesión se revoca y deja de servir en el acto.
 *
 * De la llave solo se guarda su huella (sha256), nunca la llave misma. Si
 * alguien llegara a leer esta tabla no podría entrar con lo que encuentre,
 * igual que con las contraseñas.
 */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  /** Para que la dueña reconozca el aparato al ver sus sesiones abiertas. */
  userAgent: text("user_agent"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
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

// --- Cobro -----------------------------------------------------------------

/**
 * La factura: donde la cotizacion se vuelve una deuda.
 *
 * Nace de una cotizacion aceptada o de la nada —en una fabrica de bloques
 * llega gente que compra doscientos sin cotizar nada, y si el sistema no lo
 * admite esa venta termina en un cuaderno—. Una cotizacion puede dar pie a
 * varias facturas, porque una obra se entrega por partes y se factura lo que
 * se va entregando.
 *
 * Los totales se guardan igual para los dos tipos: subtotal, IVA y total por
 * separado. La diferencia entre el credito fiscal y el consumidor final esta
 * en como se IMPRIME —desglosado o incluido en el precio—, no en cuanto paga
 * el cliente, que es lo mismo en ambos casos. Guardarlo de una sola forma
 * evita que dos documentos por la misma mercaderia terminen sumando distinto.
 */
export const invoices = pgTable("invoices", {
  customerSnapshot: jsonb("customer_snapshot"),
  businessSnapshot: jsonb("business_snapshot"),
  id: uuid("id").primaryKey().defaultRandom(),
  kind: invoiceKindEnum("kind").notNull(),
  /** Correlativo dentro de SU serie: hay una 1 de credito fiscal y una 1 de consumidor final. */
  number: integer("number").notNull(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  /** De que cotizacion salio, si salio de alguna. */
  quoteId: uuid("quote_id").references(() => quotes.id),
  issueDate: timestamp("issue_date", { withTimezone: true }).notNull(),
  status: invoiceStatusEnum("status").notNull().default("issued"),
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  taxRateMilli: integer("tax_rate_milli").notNull().default(0),
  notes: text("notes"),
  /**
   * Anular pide motivo a proposito.
   *
   * Un numero anulado sin explicacion es un hueco en la serie que dentro de
   * seis meses nadie va a saber justificar, y justamente esos huecos son los
   * que pregunta un auditor.
   */
  annulledAt: timestamp("annulled_at", { withTimezone: true }),
  annulReason: text("annul_reason"),
  annulledBy: uuid("annulled_by").references(() => users.id),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
}, (t) => ({
  /** El numero es unico DENTRO de su serie, no entre todas. */
  numeroPorSerie: unique("invoices_kind_number_unique").on(t.kind, t.number),
}));

export const invoiceLines = pgTable("invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id),
  catalogItemId: uuid("catalog_item_id").references(() => catalogItems.id),
  /**
   * De que renglon de la cotizacion sale esta linea, si sale de alguno.
   *
   * Es lo que permite saber cuanto de una cotizacion queda por facturar
   * cuando la obra se entrega en tres viajes: se compara lo cotizado contra
   * lo ya facturado, renglon por renglon.
   */
  quoteLineId: uuid("quote_line_id").references(() => quoteLines.id),
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
