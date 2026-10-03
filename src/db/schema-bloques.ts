/**
 * Modulo de fabricacion de bloques de concreto.
 *
 * Cuelga del nucleo (users, activity_log, counters) sin tocarlo, tal como
 * describe nucleodedatos.md: lo que no se parece entre rubros vive aparte.
 *
 * Tres convenciones que se respetan en todo el modulo:
 *  - Todo monto es un entero de CENTAVOS.
 *  - Toda cantidad de material es un entero de MILESIMAS de su unidad
 *    (2.5 carretillas = 2500). Asi se dosifica en fracciones sin flotantes.
 *  - Toda resistencia es un entero de MILESIMAS de MPa (13.8 MPa = 13800).
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./schema.js";

// --- Enums -----------------------------------------------------------------

/** Una receta solo se vuelve "validated" cuando tiene ensayos que la respalden. */
export const recipeStatusEnum = pgEnum("recipe_status", [
  "draft",
  "validated",
  "retired",
]);

/**
 * Sobre que area se midio la resistencia. NUNCA se guarda un MPa sin esto.
 *
 * ASTM C90 exige 13.8 MPa sobre area NETA, descontando los huecos. Otras
 * normas piden su minimo sobre area BRUTA, el rectangulo completo. En un
 * bloque hueco la diferencia pasa del doble: sin este campo, tarde o temprano
 * alguien compara los dos numeros y aprueba un bloque que no da.
 */
export const strengthBasisEnum = pgEnum("strength_basis", ["net", "gross"]);

/** Como se mide una unidad de dosificacion, para poder convertir entre ellas. */
export const unitKindEnum = pgEnum("unit_kind", ["mass", "volume", "count"]);

/** Quien hizo el ensayo. La prensa propia es el caso normal en esta planta. */
export const testSourceEnum = pgEnum("test_source", ["plant", "lab"]);

/**
 * De donde salio un numero: lo escribio una persona o lo reporto la maquina.
 *
 * Hoy (fase 1) todo dice "person": el software es la orden de trabajo y nadie
 * lo conecta al fierro. En la fase 2 la maquina va a reportar sus ciclos, y
 * ese dia van a convivir dos cifras para el mismo lote —600 ciclos contados
 * por la prensa contra 470 buenos escritos por el operario— que NO son la
 * misma medicion y no deben promediarse ni pisarse.
 *
 * Agregar esta columna despues obligaria a inventar el origen de todo lo ya
 * guardado. Nace ahora, con valor por defecto, y hasta la fase 2 no cuesta
 * nada.
 */
export const dataSourceEnum = pgEnum("data_source", ["person", "machine"]);

/**
 * En que anda una orden de produccion.
 *
 * "en_proceso" no lo pone nadie: lo pone el primer lote que se corre contra
 * la orden. "terminada" tampoco: lo pone el lote que completa lo pedido. Los
 * dos estados que si son una decision de una persona son el de nacimiento y
 * el de anulacion.
 */
export const productionOrderStatusEnum = pgEnum("production_order_status", [
  "pendiente",
  "en_proceso",
  "terminada",
  "anulada",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

// --- Ajustes del cliente ---------------------------------------------------

/**
 * Aca vive UNICAMENTE lo que el cliente cambio respecto del valor de fabrica.
 *
 * Es la decision de diseño que gobierna el modulo entero. Si al instalar
 * copiaramos los valores de fabrica dentro de la base del cliente, despues
 * seria imposible distinguir lo que el eligio de lo que apenas heredo, y
 * ninguna mejora futura seria segura de aplicar. Ya pagamos esa leccion en la
 * cotizadora: cambiamos el nombre y el logo de la empresa y ningun telefono
 * que ya tenia la app se entero, porque el perfil se habia copiado el primer
 * dia.
 *
 * El sistema resuelve cada valor asi:  ajuste del cliente ?? valor de fabrica.
 * Lo que el toco queda intocable. Lo que nunca toco puede recibir mejoras, y
 * aun asi se le avisan, nunca se aplican en silencio.
 */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  setBy: uuid("set_by").references(() => users.id),
  setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Unidades en las que la planta dosifica: bolsa, carretilla, palada, balde.
 *
 * El sistema habla en la unidad en la que el cliente ya piensa. La conversion
 * es asunto nuestro, no suyo: factorMilli lleva una unidad a la base de su
 * tipo (kg para masa, litro para volumen, pieza para conteo).
 */
export const units = pgTable("units", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  abbreviation: text("abbreviation").notNull(),
  kind: unitKindEnum("kind").notNull(),
  /** Cuanto vale 1 de esta unidad en la base de su tipo, en milesimas. */
  factorMilli: integer("factor_milli").notNull(),
  /** false para las que el cliente agrego: las de fabrica no se borran. */
  isCustom: boolean("is_custom").notNull().default(true),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
});

// --- Materia prima ---------------------------------------------------------

export const materials = pgTable("materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  category: text("category"),
  /** Como lo compra: "bolsa de 42.5 kg", "metro cubico". */
  purchaseUnit: text("purchase_unit").notNull(),
  purchasePriceCents: integer("purchase_price_cents").notNull().default(0),
  /** Cuanto rinde una unidad de compra en la unidad de dosificacion. */
  dosingUnitId: uuid("dosing_unit_id").references(() => units.id),
  contentPerPurchaseMilli: integer("content_per_purchase_milli")
    .notNull()
    .default(1000),
  /** kg por metro cubico. Permite pasar de volumen a masa cuando hace falta. */
  bulkDensityKgM3: integer("bulk_density_kg_m3"),
  /**
   * Debajo de esto hay que comprar, en milesimas de la unidad de dosificacion.
   * Nulo: nadie ha dicho cuanto es poco, y el sistema no inventa un minimo.
   */
  minStockMilli: integer("min_stock_milli"),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
});

// --- El producto -----------------------------------------------------------

/**
 * Los crea el cliente. Nada de una lista fija: si manana fabrica un bloque
 * que no previmos, lo da de alta y sigue.
 */
export const blockTypes = pgTable("block_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  lengthMm: integer("length_mm").notNull(),
  heightMm: integer("height_mm").notNull(),
  widthMm: integer("width_mm").notNull(),
  /** Geometria de los huecos, para calcular el area neta. */
  holes: jsonb("holes").$type<{ count: number; lengthMm: number; widthMm: number }[]>(),
  /**
   * Areas en mm2. Se calculan de las medidas, pero quedan editables: hay
   * bloques con huecos conicos o irregulares donde la cuenta simple no sirve
   * y el cliente tiene el dato bueno.
   */
  grossAreaMm2: integer("gross_area_mm2").notNull(),
  netAreaMm2: integer("net_area_mm2").notNull(),
  /** Resistencia objetivo, en milesimas de MPa, con su criterio de area. */
  targetStrengthMpaMilli: integer("target_strength_mpa_milli"),
  targetStrengthBasis: strengthBasisEnum("target_strength_basis"),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
});

// --- Recetas ---------------------------------------------------------------

export const recipes = pgTable("recipes", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  blockTypeId: uuid("block_type_id")
    .notNull()
    .references(() => blockTypes.id),
  status: recipeStatusEnum("status").notNull().default("draft"),
  /** Cuantos bloques espera sacar de una mezcla. Se corrige con los lotes. */
  expectedBlocksPerMix: integer("expected_blocks_per_mix"),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
});

export const recipeLines = pgTable(
  "recipe_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id),
    /** Cantidad por UNA mezcla, en milesimas de la unidad de dosificacion. */
    quantityMilli: integer("quantity_milli").notNull(),
    unitId: uuid("unit_id").references(() => units.id),
    displayOrder: integer("display_order").notNull().default(0),
    ...timestamps,
  },
  (t) => ({ porReceta: index("recipe_lines_recipe_idx").on(t.recipeId) }),
);

// --- La orden de produccion ------------------------------------------------

/**
 * El papel que le dice al maquinista que fabricar.
 *
 * Es la pieza que faltaba para cerrar el circulo que pidieron en la reunion:
 * la cotizacion se "pasa" a produccion y baja a la planta convertida en una
 * orden. Sin esto, lo que llegaba a la planta era un mensaje de WhatsApp.
 *
 * Tres decisiones que valen mas que el codigo:
 *
 *  1. **La orden nace de lo que FALTA, no de lo pedido.** Si el cliente pide
 *     1.000 bloques y en el patio hay 540, la orden dice 460. Es literalmente
 *     lo que pidieron: "que el mismo sistema detecte que si el producto ya
 *     esta en inventario, no hace falta producirlo".
 *
 *  2. **La cantidad se congela al crear la orden.** Si manana el patio cambia,
 *     la orden no cambia sola. El maquinista tiene que poder confiar en que el
 *     papel dice hoy lo mismo que decia ayer; un numero que se mueve solo
 *     mientras alguien trabaja contra el no es una orden, es una sugerencia.
 *
 *  3. **Se congela para quien es.** El nombre del cliente queda escrito, no
 *     referenciado, por la misma razon que en las cotizaciones y facturas: si
 *     el cliente se renombra o se archiva, la orden de marzo tiene que seguir
 *     diciendo para quien se corrio.
 */
export const productionOrders = pgTable(
  "production_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Correlativo propio. Es lo que se dice en voz alta: "corré la 14". */
    number: integer("number").notNull().unique(),
    /**
     * De que cotizacion salio, si salio de una. Es un uuid pelado y no una
     * llave foranea a proposito, igual que `catalog_items.block_type_id`: el
     * modulo de fabricacion no depende del comercial, se toca con el.
     */
    quoteId: uuid("quote_id"),
    /** Para quien es, congelado. Null en una orden que no sale de un pedido. */
    customerName: text("customer_name"),
    status: productionOrderStatusEnum("status").notNull().default("pendiente"),
    /** Para cuando se necesita. Sirve para ordenar la cola de la planta. */
    neededBy: timestamp("needed_by", { withTimezone: true }),
    notes: text("notes"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id),
    /** Por que se cerro o se anulo. Un cierre sin explicacion no sirve. */
    closeReason: text("close_reason"),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    porEstado: index("production_orders_status_idx").on(t.status),
    porCotizacion: index("production_orders_quote_idx").on(t.quoteId),
  }),
);

export const productionOrderLines = pgTable(
  "production_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => productionOrders.id),
    blockTypeId: uuid("block_type_id")
      .notNull()
      .references(() => blockTypes.id),
    /** Como se llamaba el bloque el dia de la orden. Congelado. */
    description: text("description").notNull(),
    /** Cuantos hay que fabricar. Ya descontado lo que habia en el patio. */
    quantity: integer("quantity").notNull(),
    /** Que renglon de la cotizacion lo pidio, si vino de una. */
    quoteLineId: uuid("quote_line_id"),
    ...timestamps,
  },
  (t) => ({ porOrden: index("production_order_lines_order_idx").on(t.orderId) }),
);

// --- Produccion ------------------------------------------------------------

export const batches = pgTable(
  "batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Correlativo, con el mismo mecanismo que las cotizaciones del nucleo. */
    number: integer("number").notNull().unique(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id),
    blockTypeId: uuid("block_type_id")
      .notNull()
      .references(() => blockTypes.id),
    producedAt: timestamp("produced_at", { withTimezone: true }).notNull(),
    /**
     * Contra que orden se corrio, si se corrio contra alguna.
     *
     * Null es un caso legitimo y frecuente: se produce para tener existencia,
     * sin que nadie lo haya pedido todavia. Eso no es una falta de orden, es
     * como trabaja una bloquera.
     */
    productionOrderId: uuid("production_order_id").references(() => productionOrders.id),
    /** Cuantas mezclas se corrieron con la receta en este lote. */
    mixes: integer("mixes").notNull().default(1),
    blocksGood: integer("blocks_good").notNull().default(0),
    blocksBroken: integer("blocks_broken").notNull().default(0),
    /** Quien conto los bloques. Ver dataSourceEnum. */
    countSource: dataSourceEnum("count_source").notNull().default("person"),
    /** Ciclos que reporto la maquina, cuando haya maquina. Null en fase 1. */
    machineCycles: integer("machine_cycles"),
    /**
     * Que mantenimiento estaba VENCIDO cuando se corrio este lote, congelado.
     *
     * Se calcula al cerrar y no se recalcula nunca, por la misma razon que el
     * costo: dentro de seis meses, cuando alguien mire un lote con 78% de
     * rendimiento, tiene que poder ver que el molde llevaba doce mezclas sin
     * limpiarse. Si esto se recalculara con el estado de hoy, esa pista se
     * perderia.
     */
    maintenanceOverdue: jsonb("maintenance_overdue").$type<
      { taskId: string; nombre: string; vencidaPor: number; unidad: "mezclas" | "lotes" }[]
    >(),
    /**
     * Costo del lote congelado con los precios del dia. No se recalcula nunca:
     * un lote de agosto tiene que seguir costando lo que costo en agosto,
     * aunque el cemento suba en septiembre.
     */
    materialCostCents: integer("material_cost_cents").notNull().default(0),
    curingDays: integer("curing_days"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    porFecha: index("batches_produced_at_idx").on(t.producedAt),
    porOrden: index("batches_production_order_idx").on(t.productionOrderId),
  }),
);

/** Lo que realmente entro al lote, con nombre y precio congelados. */
export const batchLines = pgTable(
  "batch_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id),
    materialId: uuid("material_id").references(() => materials.id),
    description: text("description").notNull(),
    quantityMilli: integer("quantity_milli").notNull(),
    unitAbbreviation: text("unit_abbreviation").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    ...timestamps,
  },
  (t) => ({ porLote: index("batch_lines_batch_idx").on(t.batchId) }),
);

// --- Control de calidad ----------------------------------------------------

export const tests = pgTable(
  "tests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id),
    testedAt: timestamp("tested_at", { withTimezone: true }).notNull(),
    /** Edad del bloque al ensayarlo. La norma pide 28 dias. */
    ageDays: integer("age_days").notNull(),
    specimens: integer("specimens").notNull().default(1),
    /** Resistencia en milesimas de MPa. Sin basis, este numero no significa nada. */
    strengthMpaMilli: integer("strength_mpa_milli").notNull(),
    basis: strengthBasisEnum("basis").notNull(),
    source: testSourceEnum("source").notNull().default("plant"),
    /** Quien leyo la prensa. Ver dataSourceEnum. */
    readingSource: dataSourceEnum("reading_source").notNull().default("person"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({ porLote: index("tests_batch_idx").on(t.batchId) }),
);

// --- Mantenimiento y limpieza ----------------------------------------------

/**
 * Puestos de trabajo, no personas.
 *
 * La gente de una planta rota; el puesto se queda. Asignar una tarea a
 * "Operario de maquina" en vez de a "Jose" significa que cuando Jose se va,
 * no hay que reasignar nada: entra otro al puesto y las tareas siguen suyas.
 *
 * Ademas, hoy la planta ni existe y no hay nadie contratado. Los puestos se
 * pueden llenar desde el primer dia; los nombres no.
 */
export const plantRoles = pgTable("plant_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
});

/**
 * Tareas de limpieza y mantenimiento, disparadas por USO y no por calendario.
 *
 * En una bloquera esto no es aseo: es control de calidad. Si el molde no se
 * limpia, el concreto fragua adentro y el bloque siguiente sale deforme y mas
 * debil. Si el vibrador pierde ajuste, baja la compactacion y con ella la
 * resistencia. Y el desgaste del molde cambia las medidas del bloque, que es
 * justo el numero con el que se calcula el area neta.
 *
 * Por eso el disparador es el uso —cada N mezclas o cada N lotes— y no el dia
 * de la semana: una semana de mucha produccion ensucia mas que una floja.
 *
 * Los intervalos vienen con un valor de arranque y son editables, igual que
 * los rangos de mezcla. Y como los rangos, el valor de fabrica es una
 * referencia, no una verdad: EL MANUAL DE LA MAQUINA MANDA. Nosotros no
 * conocemos la prensa de este cliente.
 */
export const maintenanceTasks = pgTable("maintenance_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  roleId: uuid("role_id").references(() => plantRoles.id),
  /** Cada cuantas MEZCLAS toca. Null si se mide por lotes. */
  everyMixes: integer("every_mixes"),
  /** Cada cuantos LOTES toca. Null si se mide por mezclas. */
  everyBatches: integer("every_batches"),
  /** false para las que agrego el cliente: las de fabrica no se borran. */
  isCustom: boolean("is_custom").notNull().default(true),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
});

/**
 * Cada vez que la tarea se hizo. Congela el contador de ese momento, que es
 * lo unico que permite calcular despues "cuantas mezclas van desde entonces".
 */
export const maintenanceLogs = pgTable(
  "maintenance_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => maintenanceTasks.id),
    doneAt: timestamp("done_at", { withTimezone: true }).notNull().defaultNow(),
    /** Contadores acumulados de la planta al momento de hacerla. */
    atMixes: integer("at_mixes").notNull().default(0),
    atBatches: integer("at_batches").notNull().default(0),
    /** Puesto que la hizo, congelado por nombre: si el puesto se renombra, esto no miente. */
    roleName: text("role_name"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({ porTarea: index("maintenance_logs_task_idx").on(t.taskId) }),
);

// --- Almacen: lo que se compra y lo que hay de materia prima ---------------

export const materialMoveReasonEnum = pgEnum("material_move_reason", [
  "compra",
  "consumo",
  "ajuste",
  "merma",
  "devolucion",
]);

export const purchaseStatusEnum = pgEnum("purchase_status", ["abierta", "cancelada"]);

export const countStatusEnum = pgEnum("count_status", ["abierto", "aprobado", "cancelado"]);

/** A quien se le compra. Solo proveedores de insumos: no hay compra de producto terminado. */
export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  nit: text("nit"),
  nrc: text("nrc"),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
});

/**
 * Una compra: lo que se le pidio a un proveedor.
 *
 * Pedirla NO mete nada al almacen. Lo que lo mete es la recepcion, que puede
 * ser parcial y en varias fechas. Tampoco hay aca ningun pago: la deuda con el
 * proveedor es otra pieza, y el documento del proveedor, otro dato.
 */
export const purchases = pgTable("purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: integer("number").notNull().unique(),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id),
  orderedOn: timestamp("ordered_on", { withTimezone: true }).notNull().defaultNow(),
  /** Numero del documento del proveedor, si ya lo mando. */
  documentRef: text("document_ref"),
  notes: text("notes"),
  status: purchaseStatusEnum("status").notNull().default("abierta"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
});

/**
 * Lo pedido, con nombre, unidad y conversion congelados.
 *
 * Cantidad y costo van en la unidad de COMPRA (bolsa, metro cubico). La
 * conversion a la unidad en que se dosifica se congela aqui, igual que el
 * costo del lote: si manana la bolsa cambia de contenido, esta compra sigue
 * valiendo lo que valia.
 */
export const purchaseLines = pgTable(
  "purchase_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id),
    description: text("description").notNull(),
    purchaseUnit: text("purchase_unit").notNull(),
    /** Cuantas unidades de dosificacion trae una de compra, en milesimas. */
    contentPerPurchaseMilli: integer("content_per_purchase_milli").notNull(),
    quantityMilli: integer("quantity_milli").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    ...timestamps,
  },
  (t) => ({ porCompra: index("purchase_lines_purchase_idx").on(t.purchaseId) }),
);

/** Una llegada de mercaderia. Una compra puede tener varias. */
export const purchaseReceipts = pgTable(
  "purchase_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: integer("number").notNull().unique(),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id),
    receivedOn: timestamp("received_on", { withTimezone: true }).notNull().defaultNow(),
    /** Remision o factura que trae el proveedor con esta entrega. */
    documentRef: text("document_ref"),
    notes: text("notes"),
    annulledAt: timestamp("annulled_at", { withTimezone: true }),
    annulReason: text("annul_reason"),
    annulledBy: uuid("annulled_by").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({ porCompra: index("purchase_receipts_purchase_idx").on(t.purchaseId) }),
);

export const purchaseReceiptLines = pgTable(
  "purchase_receipt_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => purchaseReceipts.id),
    purchaseLineId: uuid("purchase_line_id")
      .notNull()
      .references(() => purchaseLines.id),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id),
    /** Lo recibido, en unidades de compra. */
    quantityMilli: integer("quantity_milli").notNull(),
    /** Lo mismo ya convertido a la unidad de dosificacion: lo que entra al almacen. */
    dosingQuantityMilli: integer("dosing_quantity_milli").notNull(),
    /** Lo que costo de verdad, que puede no ser lo pedido. */
    unitCostCents: integer("unit_cost_cents").notNull(),
    costCents: integer("cost_cents").notNull(),
    ...timestamps,
  },
  (t) => ({ porRecepcion: index("purchase_receipt_lines_receipt_idx").on(t.receiptId) }),
);

/**
 * Cada vez que un material entra o sale. La existencia es la suma de esta tabla.
 *
 * Misma regla que el patio de bloques: no hay ninguna columna "existencia".
 * Un error se corrige con otro movimiento, no editando ni borrando.
 */
export const materialMoves = pgTable(
  "material_moves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id),
    /** En milesimas de la unidad de dosificacion. Positivo entra, negativo sale. */
    quantityMilli: integer("quantity_milli").notNull(),
    reason: materialMoveReasonEnum("reason").notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    /** Lo que valia lo que entro, cuando se sabe (una compra). Los consumos y ajustes lo dejan en nulo. */
    costCents: integer("cost_cents"),
    note: text("note"),
    notedAt: timestamp("noted_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    porMaterial: index("material_moves_material_idx").on(t.materialId),
    porOrigen: index("material_moves_ref_idx").on(t.refType, t.refId),
  }),
);

/**
 * Un conteo fisico: alguien recorre la bodega y cuenta.
 *
 * Al abrirlo se congela lo que el sistema creia que habia (expected). Lo
 * contado se compara contra eso, y al aprobar se registra la DIFERENCIA como
 * un movimiento de ajuste: si entro o salio algo mientras se contaba, no se
 * pisa, se suma.
 */
export const materialCounts = pgTable("material_counts", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: integer("number").notNull().unique(),
  status: countStatusEnum("status").notNull().default("abierto"),
  notes: text("notes"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: uuid("approved_by").references(() => users.id),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps,
});

export const materialCountLines = pgTable(
  "material_count_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countId: uuid("count_id")
      .notNull()
      .references(() => materialCounts.id),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id),
    description: text("description").notNull(),
    unitAbbreviation: text("unit_abbreviation").notNull(),
    expectedMilli: integer("expected_milli").notNull(),
    /** Nulo: todavia no se conto. Cero es un conteo valido: contaron y no hay nada. */
    countedMilli: integer("counted_milli"),
    note: text("note"),
    ...timestamps,
  },
  (t) => ({ porConteo: index("material_count_lines_count_idx").on(t.countId) }),
);
