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
    /** Cuantas mezclas se corrieron con la receta en este lote. */
    mixes: integer("mixes").notNull().default(1),
    blocksGood: integer("blocks_good").notNull().default(0),
    blocksBroken: integer("blocks_broken").notNull().default(0),
    /** Quien conto los bloques. Ver dataSourceEnum. */
    countSource: dataSourceEnum("count_source").notNull().default("person"),
    /** Ciclos que reporto la maquina, cuando haya maquina. Null en fase 1. */
    machineCycles: integer("machine_cycles"),
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
  (t) => ({ porFecha: index("batches_produced_at_idx").on(t.producedAt) }),
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
