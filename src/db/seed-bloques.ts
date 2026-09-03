/**
 * Siembra del módulo de bloques.
 *
 * Dos cosas distintas, y conviene no confundirlas:
 *
 *  - Lo de FÁBRICA (unidades, materiales, tipos de bloque) sale de
 *    defaults.ts y es lo que trae el sistema recién instalado. Los precios
 *    nacen en CERO a propósito: son de este cliente y de esta semana.
 *
 *  - Lo de DEMOSTRACIÓN (precios de Titán, la receta, el lote 003 con su
 *    ensayo) existe para que la primera presentación tenga algo que enseñar.
 *    Se siembra solo con --demo y se puede borrar sin tocar lo de fábrica.
 *
 * Idempotente: se puede correr dos veces sin duplicar nada.
 */

import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, pool } from "./client.js";
import { users, counters } from "./schema.js";
import {
  units,
  materials,
  blockTypes,
  recipes,
  recipeLines,
  batches,
  batchLines,
  tests,
  settings,
} from "./schema-bloques.js";
import {
  UNIDADES_FABRICA,
  MATERIALES_FABRICA,
  TIPOS_BLOQUE_FABRICA,
  areasDe,
} from "../bloques/defaults.js";

const demo = process.argv.includes("--demo");

async function sembrarFabrica() {
  // --- Unidades ------------------------------------------------------------
  for (const u of UNIDADES_FABRICA) {
    await db
      .insert(units)
      .values({
        name: u.name,
        abbreviation: u.abbreviation,
        kind: u.kind,
        factorMilli: u.factorMilli,
        isCustom: false,
      })
      .onConflictDoNothing();
  }
  // abbreviation no es única en el esquema: deduplicamos por nombre acá.
  const todas = await db.select().from(units);
  const porAbrev = new Map<string, string>();
  for (const u of todas) if (!porAbrev.has(u.abbreviation)) porAbrev.set(u.abbreviation, u.id);

  // --- Materiales ----------------------------------------------------------
  for (const m of MATERIALES_FABRICA) {
    await db
      .insert(materials)
      .values({
        code: m.code,
        name: m.name,
        category: m.category,
        purchaseUnit: m.purchaseUnit,
        purchasePriceCents: 0,
        dosingUnitId: porAbrev.get(m.dosing) ?? null,
        contentPerPurchaseMilli: m.contentPerPurchaseMilli,
        bulkDensityKgM3: m.bulkDensityKgM3,
      })
      .onConflictDoNothing({ target: materials.code });
  }

  // --- Tipos de bloque -----------------------------------------------------
  for (const t of TIPOS_BLOQUE_FABRICA) {
    const a = areasDe(t);
    await db
      .insert(blockTypes)
      .values({
        code: t.code,
        name: t.name,
        lengthMm: t.lengthMm,
        heightMm: t.heightMm,
        widthMm: t.widthMm,
        holes: [...t.holes],
        grossAreaMm2: a.grossAreaMm2,
        netAreaMm2: a.netAreaMm2,
        targetStrengthMpaMilli: 13_800,
        targetStrengthBasis: "net",
      })
      .onConflictDoNothing({ target: blockTypes.code });
  }

  return porAbrev;
}

async function sembrarDemo(porAbrev: Map<string, string>) {
  // --- Un usuario para que activity_log tenga autor -------------------------
  const [usuario] = await db
    .insert(users)
    .values({
      name: "Operador de planta",
      email: "planta@bloquestitan.sv",
      passwordHash: await bcrypt.hash("cambiar-esta-clave", 10),
      role: "staff",
    })
    .onConflictDoNothing({ target: users.email })
    .returning();

  const autor =
    usuario?.id ??
    (await db.select().from(users).where(eq(users.email, "planta@bloquestitan.sv")))[0]?.id ??
    null;

  // --- Precios reales de Titán ---------------------------------------------
  const precios: Record<string, number> = {
    cemento: 1_050, //  $10.50 la bolsa de 42.5 kg
    arena: 2_800, //    $28.00 el metro cúbico
    grava: 3_200, //    $32.00 el metro cúbico
    agua: 150, //        $1.50 el metro cúbico
  };
  for (const [code, cents] of Object.entries(precios)) {
    await db
      .update(materials)
      .set({ purchasePriceCents: cents, updatedAt: new Date() })
      .where(eq(materials.code, code));
  }

  const mats = await db.select().from(materials);
  const matPorCode = new Map(mats.map((m) => [m.code, m]));
  const [b15] = await db.select().from(blockTypes).where(eq(blockTypes.code, "B15"));
  if (!b15) throw new Error("Falta el tipo de bloque B15");

  /**
   * El cliente ensanchó el rango de cemento:agregado.
   *
   * Su mezcla real da 1:15.4 y la norma llega a 1:9. Al ensancharlo hasta
   * 1:16 el sistema deja de avisarle — que es su derecho— pero la norma
   * sigue dibujada detrás. Es exactamente el caso que el módulo existe para
   * mostrar: apartarse de la norma como decisión, no como descuido.
   */
  await db
    .insert(settings)
    .values({ key: "rango.cemento_agregado", value: { min: 6, max: 16 }, setBy: autor })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: { min: 6, max: 16 }, setBy: autor, setAt: new Date() },
    });

  // --- La receta -----------------------------------------------------------
  const RENGLONES = [
    { code: "cemento", cantidadMilli: 1_000, unidad: "bolsa" }, //  1 bolsa
    { code: "arena", cantidadMilli: 4_000, unidad: "carretilla" }, // 4 carretillas
    { code: "grava", cantidadMilli: 3_000, unidad: "carretilla" }, // 3 carretillas
    { code: "agua", cantidadMilli: 20_000, unidad: "L" }, //        20 litros
  ];

  let [receta] = await db.select().from(recipes).where(eq(recipes.code, "MEZCLA-EST"));
  if (!receta) {
    [receta] = await db
      .insert(recipes)
      .values({
        code: "MEZCLA-EST",
        name: "Mezcla estándar",
        blockTypeId: b15.id,
        status: "draft",
        expectedBlocksPerMix: 60,
        notes: "La mezcla que la planta corre a diario para bloque de 15.",
        createdBy: autor,
      })
      .returning();
    if (!receta) throw new Error("No se pudo crear la receta");

    await db.insert(recipeLines).values(
      RENGLONES.map((r, i) => {
        const m = matPorCode.get(r.code);
        if (!m) throw new Error(`Falta el material ${r.code}`);
        return {
          recipeId: receta!.id,
          materialId: m.id,
          quantityMilli: r.cantidadMilli,
          unitId: porAbrev.get(r.unidad) ?? null,
          displayOrder: i,
        };
      }),
    );
  }

  // --- El lote 003 con su ensayo -------------------------------------------
  const yaHayLotes = await db.select({ n: sql<number>`count(*)` }).from(batches);
  if (Number(yaHayLotes[0]?.n ?? 0) > 0) {
    console.log("Ya hay lotes: no se siembran los de demostración.");
    return;
  }

  const MEZCLAS = 10;
  const congeladas = RENGLONES.map((r) => {
    const m = matPorCode.get(r.code)!;
    const cantidad = r.cantidadMilli * MEZCLAS;
    const contenido = Math.max(1, m.contentPerPurchaseMilli);
    return {
      materialId: m.id,
      description: m.name,
      quantityMilli: cantidad,
      unitAbbreviation: r.unidad,
      unitPriceCents: m.purchasePriceCents,
      subtotalCents: Math.round((cantidad * m.purchasePriceCents) / contenido),
    };
  });
  const costoTotal = congeladas.reduce((s, l) => s + l.subtotalCents, 0);

  const producidoEl = new Date("2026-08-04T13:00:00Z");

  await db
    .insert(counters)
    .values({ id: "batch", value: 3 })
    .onConflictDoUpdate({ target: counters.id, set: { value: 3 } });

  const [lote] = await db
    .insert(batches)
    .values({
      number: 3,
      recipeId: receta.id,
      blockTypeId: b15.id,
      producedAt: producidoEl,
      mixes: MEZCLAS,
      blocksGood: 470,
      blocksBroken: 130,
      materialCostCents: costoTotal,
      countSource: "person",
      curingDays: 14,
      notes: "Se rompieron más de lo normal al desmoldar.",
      createdBy: autor,
    })
    .returning();
  if (!lote) throw new Error("No se pudo crear el lote");

  await db.insert(batchLines).values(congeladas.map((c) => ({ ...c, batchId: lote.id })));

  await db.insert(tests).values({
    batchId: lote.id,
    testedAt: new Date("2026-09-01T15:00:00Z"),
    ageDays: 28,
    specimens: 3,
    strengthMpaMilli: 14_200,
    basis: "net",
    source: "plant",
    readingSource: "person",
    notes: "Prensa propia. Promedio de tres probetas.",
    createdBy: autor,
  });

  /** El lote cumplió, así que la receta puede validarse. */
  await db.update(recipes).set({ status: "validated" }).where(eq(recipes.id, receta.id));

  console.log(
    `Lote 003 sembrado: costo congelado $${(costoTotal / 100).toFixed(2)}, ` +
      `470 buenos de 600, ensayo 14.2 MPa en área neta.`,
  );
}

async function main() {
  const porAbrev = await sembrarFabrica();
  console.log("Valores de fábrica sembrados.");
  if (demo) await sembrarDemo(porAbrev);
  else console.log("Sin --demo: no se sembraron datos de demostración.");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
