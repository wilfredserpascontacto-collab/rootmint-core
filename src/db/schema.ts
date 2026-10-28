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
  index,
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

/**
 * El recibo del guardado: qué documento salió de cada intento.
 *
 * La pantalla inventa una llave por cada intento de guardar y la repite si
 * reintenta. Si la misma llave vuelve, acá está anotado qué se creó la
 * primera vez y se devuelve eso en lugar de crear otro. Sin esto, un doble
 * clic de la secretaria son dos cotizaciones —molesto— o dos créditos
 * fiscales con números corridos por una sola venta, que ya hay que anular
 * ante Hacienda.
 *
 * Se escribe dentro de la misma transacción que el documento, así que si el
 * documento falla la llave tampoco queda: no existe el caso de una llave
 * quemada sin nada que devolver.
 */
export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  scope: text("scope").notNull(),
  entityId: uuid("entity_id").notNull(),
  userId: uuid("user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  /**
   * Que tipo de bloque es este producto, cuando es un bloque.
   *
   * Hasta aca el catalogo comercial y los tipos de bloque de produccion eran
   * dos mundos que no se conocian: "Bloque 15x20x40" existia dos veces, una
   * para vender y otra para fabricar, sin nada que dijera que eran el mismo.
   * Por eso no se podia saber si lo que un cliente pide ya esta hecho.
   *
   * Nulo en todo lo que no sea un bloque: la mano de obra, el flete y el
   * alquiler de formaleta se venden y no se producen.
   */
  blockTypeId: uuid("block_type_id"),
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

// --- Inventario de producto terminado --------------------------------------

/** Por que entro o salio algo del inventario. */
export const inventoryReasonEnum = pgEnum("inventory_reason", [
  "produccion",
  "venta",
  "ajuste",
  "rotura",
  "devolucion",
]);

/**
 * Cuantos bloques hay, contado como se cuenta la plata: por movimientos.
 *
 * No hay ninguna columna que diga "existencia". La existencia es la suma de
 * esta tabla, y eso es a proposito: un numero guardado se desincroniza el dia
 * que alguien escribe mal una correccion, y a partir de ahi nadie vuelve a
 * creerle. Sumando movimientos, el numero siempre se puede explicar renglon
 * por renglon — de donde salio cada bloque y adonde se fue.
 *
 * Por la misma razon aca no se borra nada. Un error se corrige con otro
 * movimiento en sentido contrario, igual que en una contabilidad. Borrar una
 * linea haria que el numero de hoy no coincidiera con la historia de ayer.
 */
export const inventoryMoves = pgTable("inventory_moves", {
  id: uuid("id").primaryKey().defaultRandom(),
  blockTypeId: uuid("block_type_id").notNull(),
  /** Positivo entra, negativo sale. Sin excepciones. */
  quantity: integer("quantity").notNull(),
  reason: inventoryReasonEnum("reason").notNull(),
  /**
   * De donde viene el movimiento: el lote que lo produjo, la factura que lo
   * saco. Sirve para poder ir del numero al documento que lo explica.
   */
  refType: text("ref_type"),
  refId: uuid("ref_id"),
  note: text("note"),
  notedAt: timestamp("noted_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Pedidos y reservas -----------------------------------------------------

export const salesOrderStatusEnum = pgEnum("sales_order_status", ["abierto", "cancelado"]);

/**
 * El pedido: lo que un cliente nos compro y falta entregar.
 *
 * Una cotizacion es una oferta; un pedido es un compromiso. Por eso es un
 * documento aparte: tiene cantidades pedidas, lo ya facturado y lo apartado
 * del patio para el. Nace de una cotizacion o de la nada (llega alguien y
 * compra doscientos).
 *
 * Nada de esto se guarda como saldo. Lo facturado sale de las facturas
 * emitidas que apuntan al renglon, y la reserva vigente es lo apartado menos lo
 * ya facturado: anular una factura devuelve la reserva sola.
 */
export const salesOrders = pgTable("sales_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: integer("number").notNull().unique(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  /** Congelado: el pedido de marzo tiene que decir para quien fue aunque se renombre. */
  customerName: text("customer_name").notNull(),
  quoteId: uuid("quote_id").references(() => quotes.id),
  status: salesOrderStatusEnum("status").notNull().default("abierto"),
  neededBy: timestamp("needed_by", { withTimezone: true }),
  deliveryAddress: text("delivery_address"),
  notes: text("notes"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  cancelledBy: uuid("cancelled_by").references(() => users.id),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
});

export const salesOrderLines = pgTable("sales_order_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => salesOrders.id),
  catalogItemId: uuid("catalog_item_id").references(() => catalogItems.id),
  quoteLineId: uuid("quote_line_id").references(() => quoteLines.id),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  /**
   * Cuanto del patio se aparto para este renglon. Es una promesa hecha en un
   * momento; lo que sigue vigente se calcula (ver lib/reservas.ts).
   */
  reservedQuantity: integer("reserved_quantity").notNull().default(0),
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
  /** De que pedido salio, si salio de alguno. */
  salesOrderId: uuid("sales_order_id").references(() => salesOrders.id),
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
  /** De que renglon de pedido sale, si sale de alguno. */
  salesOrderLineId: uuid("sales_order_line_id").references(() => salesOrderLines.id),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  subtotalCents: integer("subtotal_cents").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  ...timestamps,
});

// --- Lo que el cliente va pagando ------------------------------------------

export const paymentMethodEnum = pgEnum("payment_method", [
  "efectivo",
  "transferencia",
  "cheque",
  "tarjeta",
  "otro",
]);

/**
 * Un cobro: plata que entro contra una factura.
 *
 * Una factura puede cobrarse en varias veces —el cliente de una obra paga por
 * partes—, asi que el saldo nunca se guarda: se calcula siempre como el total
 * de la factura menos lo cobrado. Un saldo guardado se desincroniza el dia que
 * alguien anota mal un pago, igual que pasa con el inventario.
 *
 * Un cobro equivocado no se borra: se anula con su motivo, y deja de contar.
 * Quien pregunte dentro de seis meses por que el saldo de un cliente cambio
 * tiene que poder verlo escrito.
 */
export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id),
  amountCents: integer("amount_cents").notNull(),
  paidOn: timestamp("paid_on", { withTimezone: true }).notNull().defaultNow(),
  method: paymentMethodEnum("method").notNull().default("efectivo"),
  /** Numero de cheque, de transferencia o de recibo: lo que permite encontrarlo en el banco. */
  reference: text("reference"),
  note: text("note"),
  annulledAt: timestamp("annulled_at", { withTimezone: true }),
  annulReason: text("annul_reason"),
  annulledBy: uuid("annulled_by").references(() => users.id),
  createdBy: uuid("created_by").references(() => users.id),
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
  /** El NRC del emisor: un credito fiscal sin el no le sirve al cliente. */
  nrc: text("nrc").notNull().default(""),
  terms: text("terms").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Despacho ---------------------------------------------------------------

export const deliveryStatusEnum = pgEnum("delivery_status", ["entregado", "anulado"]);

/**
 * El despacho: el papel que firma quien recibe los bloques.
 *
 * Existe porque facturar y entregar son dos actos distintos, y confundirlos
 * hace mentir al patio. Se factura el lunes y el camion sale el miercoles, o
 * sale en tres viajes. Mientras el sistema descontaba el patio al facturar, en
 * esos dias el patio decia que no habia bloques que estaban ahi, a la vista de
 * todos.
 *
 * Por eso el movimiento del patio cuelga de ACA y no de la factura: el bloque
 * sale cuando sale, no cuando se cobra. Una factura que se entrega en el acto
 * —el que llega, paga y carga— crea su despacho en el mismo momento, para que
 * el caso comun siga siendo un solo toque.
 *
 * Quien recibe firma con el dedo y se le toman fotos de la carga. Eso no es
 * adorno: cuando el cliente dice que llegaron 180 y no 200, o que llegaron
 * quebrados, lo unico que queda en pie es la firma y la foto del camion
 * cargado.
 */
export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Correlativo propio. No comparte serie con las facturas: no es un documento fiscal. */
    number: integer("number").notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    /** Congelado, como en todos lados: el despacho de marzo dice a quien se le entrego. */
    customerName: text("customer_name").notNull(),
    /** De donde sale, si sale de algo. Los dos pueden ser nulos: se entrega y punto. */
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    salesOrderId: uuid("sales_order_id").references(() => salesOrders.id),
    status: deliveryStatusEnum("status").notNull().default("entregado"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull().defaultNow(),
    /** Quien recibio, de su puno. Un despacho sin nombre no sirve para reclamar nada. */
    receivedByName: text("received_by_name").notNull(),
    /** Su documento, si lo dio. Opcional: en una obra casi nunca lo dan. */
    receivedByDocument: text("received_by_document"),
    address: text("address"),
    driverName: text("driver_name"),
    vehiclePlate: text("vehicle_plate"),
    notes: text("notes"),
    /**
     * La firma, dibujada con el dedo, como dataURL.
     *
     * Va en la base y no en un archivo aparte a proposito: un volumen de disco
     * en el servidor se pierde en una migracion y nadie se entera hasta que
     * hace falta la firma. Lo que esta en la base viaja en el respaldo.
     */
    signature: text("signature"),
    annulledAt: timestamp("annulled_at", { withTimezone: true }),
    annulReason: text("annul_reason"),
    annulledBy: uuid("annulled_by").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    porCliente: index("deliveries_customer_idx").on(t.customerId),
    porFactura: index("deliveries_invoice_idx").on(t.invoiceId),
    porPedido: index("deliveries_order_idx").on(t.salesOrderId),
    porEstado: index("deliveries_status_idx").on(t.status),
  }),
);

export const deliveryLines = pgTable(
  "delivery_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveries.id),
    catalogItemId: uuid("catalog_item_id").references(() => catalogItems.id),
    /** Que bloque salio del patio. Nulo en lo que no tiene patio (flete, mano de obra). */
    blockTypeId: uuid("block_type_id"),
    /** Que renglon de la factura se esta entregando, si viene de una. */
    invoiceLineId: uuid("invoice_line_id").references(() => invoiceLines.id),
    salesOrderLineId: uuid("sales_order_line_id").references(() => salesOrderLines.id),
    /** Congelado, como se llamaba el dia de la entrega. */
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    ...timestamps,
  },
  (t) => ({
    porDespacho: index("delivery_lines_delivery_idx").on(t.deliveryId),
    porRenglonFactura: index("delivery_lines_invoice_line_idx").on(t.invoiceLineId),
  }),
);

/**
 * Las fotos de la carga, en su propia tabla.
 *
 * Aparte de `deliveries` a proposito: la lista de despachos se lee todo el
 * tiempo y no puede arrastrar varios megas de fotos que nadie esta mirando.
 * Aca se leen solo cuando alguien abre un despacho.
 */
export const deliveryPhotos = pgTable(
  "delivery_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveries.id),
    /** La foto como dataURL, ya achicada por el telefono antes de subirla. */
    dataUrl: text("data_url").notNull(),
    caption: text("caption"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (t) => ({ porDespacho: index("delivery_photos_delivery_idx").on(t.deliveryId) }),
);
