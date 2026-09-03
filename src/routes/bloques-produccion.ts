/**
 * Recetas, lotes y ensayos.
 *
 * Dos reglas que se sostienen desde acá:
 *
 *  1. Al abrir un lote se CONGELA el costo con los precios de ese día, en
 *     batch_lines. Si el cemento sube en septiembre, el lote de agosto sigue
 *     costando lo de agosto.
 *
 *  2. No hay ningún endpoint que devuelva el costo de un lote sin devolver
 *     también en qué estado está su resistencia. Es la regla del módulo, y
 *     vive en la forma de la API, no en un comentario.
 */

import type { FastifyInstance } from "fastify";
import { and, eq, isNull, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  recipes,
  recipeLines,
  batches,
  batchLines,
  tests,
  materials,
  units,
  blockTypes,
} from "../db/schema-bloques.js";
import { logActivity } from "../lib/activity-log.js";
import { getUserId } from "../lib/request-context.js";
import { nextCorrelativo } from "../lib/counters.js";
import { recetaConCosto, fichaDelLote, lotesRecientes, leerResolver } from "../bloques/servicio.js";
import { vencidasAhora } from "../bloques/mantenimiento.js";

const renglonSchema = z.object({
  materialId: z.string().uuid(),
  quantityMilli: z.number().int().positive(),
  unitId: z.string().uuid().optional(),
});

const recetaSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  blockTypeId: z.string().uuid(),
  expectedBlocksPerMix: z.number().int().positive(),
  notes: z.string().optional(),
  renglones: z.array(renglonSchema).min(1),
});

export async function bloquesProduccionRoutes(app: FastifyInstance) {
  // --- Recetas -------------------------------------------------------------

  app.get("/bloques/recetas", async () =>
    db
      .select({
        id: recipes.id,
        code: recipes.code,
        name: recipes.name,
        status: recipes.status,
        expectedBlocksPerMix: recipes.expectedBlocksPerMix,
        blockTypeId: recipes.blockTypeId,
        tipoBloque: blockTypes.name,
      })
      .from(recipes)
      .leftJoin(blockTypes, eq(recipes.blockTypeId, blockTypes.id))
      .where(isNull(recipes.deletedAt))
      .orderBy(recipes.name),
  );

  /** La receta con su costo teórico y sus advertencias contra los rangos. */
  app.get("/bloques/recetas/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await recetaConCosto(id);
    if (!r) return reply.code(404).send({ error: "No encontrada" });
    return r;
  });

  app.post("/bloques/recetas", async (req, reply) => {
    const body = recetaSchema.parse(req.body);
    const creada = await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(recipes)
        .values({
          code: body.code,
          name: body.name,
          blockTypeId: body.blockTypeId,
          expectedBlocksPerMix: body.expectedBlocksPerMix,
          notes: body.notes,
          status: "draft",
          createdBy: getUserId(req),
        })
        .returning();
      if (!r) throw new Error("No se pudo crear la receta");

      await tx.insert(recipeLines).values(
        body.renglones.map((l, i) => ({
          recipeId: r.id,
          materialId: l.materialId,
          quantityMilli: l.quantityMilli,
          unitId: l.unitId,
          displayOrder: i,
        })),
      );

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "recipes",
        entityId: r.id,
        action: "create",
        newValues: r,
      });
      return r;
    });
    return reply.code(201).send(await recetaConCosto(creada.id));
  });

  /**
   * Validar una receta exige un lote suyo que CUMPLA en un ensayo real.
   * No se valida por decreto: eso convertiría el estado en decoración.
   */
  app.post("/bloques/recetas/:id/validar", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [receta] = await db.select().from(recipes).where(eq(recipes.id, id));
    if (!receta) return reply.code(404).send({ error: "No encontrada" });

    const res = await leerResolver();
    const [tipo] = await db.select().from(blockTypes).where(eq(blockTypes.id, receta.blockTypeId));
    const objetivo =
      tipo?.targetStrengthMpaMilli ?? res.numero("proceso.resistencia_objetivo_mpa_milli");
    const criterio = tipo?.targetStrengthBasis ?? "net";

    const respaldo = await db
      .select({ testId: tests.id, mpa: tests.strengthMpaMilli, basis: tests.basis, batch: batches.number })
      .from(tests)
      .innerJoin(batches, eq(tests.batchId, batches.id))
      .where(eq(batches.recipeId, id));

    const bueno = respaldo.find((t) => t.basis === criterio && t.mpa >= objetivo);
    if (!bueno) {
      return reply.code(409).send({
        error: "No se puede validar",
        detalle:
          respaldo.length === 0
            ? "Ningún lote de esta receta tiene ensayo todavía."
            : `Ningún ensayo alcanza ${objetivo / 1000} MPa en área ${criterio === "net" ? "neta" : "bruta"}.`,
        ensayos: respaldo,
      });
    }

    const [after] = await db
      .update(recipes)
      .set({ status: "validated", updatedAt: new Date() })
      .where(eq(recipes.id, id))
      .returning();
    return after;
  });

  // --- Lotes ---------------------------------------------------------------

  app.get("/bloques/lotes", async () => lotesRecientes());

  /** Costo y resistencia, juntos. No hay forma de pedir solo uno. */
  app.get("/bloques/lotes/:id/ficha", async (req, reply) => {
    const { id } = req.params as { id: string };
    const f = await fichaDelLote(id);
    if (!f) return reply.code(404).send({ error: "No encontrado" });
    return f;
  });

  const loteSchema = z.object({
    recipeId: z.string().uuid(),
    producedAt: z.coerce.date().optional(),
    mixes: z.number().int().positive().default(1),
    blocksGood: z.number().int().nonnegative().default(0),
    blocksBroken: z.number().int().nonnegative().default(0),
    notes: z.string().optional(),
  });

  /**
   * Abrir un lote congela el costo del material con los precios de hoy.
   * Se guarda renglón por renglón en batch_lines: el nombre y el precio
   * quedan escritos, no referenciados.
   */
  app.post("/bloques/lotes", async (req, reply) => {
    const body = loteSchema.parse(req.body);

    const [receta] = await db.select().from(recipes).where(eq(recipes.id, body.recipeId));
    if (!receta) return reply.code(400).send({ error: "La receta no existe" });

    const lineas = await db
      .select({
        materialId: recipeLines.materialId,
        quantityMilli: recipeLines.quantityMilli,
        displayOrder: recipeLines.displayOrder,
        nombre: materials.name,
        precioCents: materials.purchasePriceCents,
        contenidoMilli: materials.contentPerPurchaseMilli,
        unidad: units.abbreviation,
      })
      .from(recipeLines)
      .leftJoin(materials, eq(recipeLines.materialId, materials.id))
      .leftJoin(units, eq(materials.dosingUnitId, units.id))
      .where(eq(recipeLines.recipeId, body.recipeId))
      .orderBy(recipeLines.displayOrder);

    if (lineas.length === 0) {
      return reply.code(400).send({ error: "La receta no tiene renglones" });
    }

    /**
     * Se calcula ANTES de insertar: lo que importa es como estaba la maquina
     * cuando se corrio el lote, no despues de contarlo.
     */
    const mantenimientoVencido = await vencidasAhora();

    const creado = await db.transaction(async (tx) => {
      const numero = await nextCorrelativo(tx, "batch");

      const congeladas = lineas.map((l) => {
        const cantidad = l.quantityMilli * body.mixes;
        const contenido = Math.max(1, l.contenidoMilli ?? 1000);
        const subtotal = Math.round((cantidad * (l.precioCents ?? 0)) / contenido);
        return {
          materialId: l.materialId,
          description: l.nombre ?? "Material eliminado del catálogo",
          quantityMilli: cantidad,
          unitAbbreviation: l.unidad ?? "u",
          unitPriceCents: l.precioCents ?? 0,
          subtotalCents: subtotal,
        };
      });

      const costoTotal = congeladas.reduce((s, l) => s + l.subtotalCents, 0);

      const [lote] = await tx
        .insert(batches)
        .values({
          number: numero,
          recipeId: body.recipeId,
          blockTypeId: receta.blockTypeId,
          producedAt: body.producedAt ?? new Date(),
          mixes: body.mixes,
          blocksGood: body.blocksGood,
          blocksBroken: body.blocksBroken,
          materialCostCents: costoTotal,
          countSource: "person",
          maintenanceOverdue: mantenimientoVencido.length ? mantenimientoVencido : null,
          curingDays: null,
          notes: body.notes,
          createdBy: getUserId(req),
        })
        .returning();
      if (!lote) throw new Error("No se pudo crear el lote");

      await tx.insert(batchLines).values(congeladas.map((c) => ({ ...c, batchId: lote.id })));

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "batches",
        entityId: lote.id,
        action: "create",
        newValues: lote,
      });
      return lote;
    });

    return reply.code(201).send(await fichaDelLote(creado.id));
  });

  /**
   * Solo el conteo se corrige después. El costo congelado NO se toca acá:
   * si cambió lo que entró de verdad, eso es otro lote o una corrección
   * explícita, no una edición silenciosa.
   */
  app.patch("/bloques/lotes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        blocksGood: z.number().int().nonnegative().optional(),
        blocksBroken: z.number().int().nonnegative().optional(),
        machineCycles: z.number().int().nonnegative().optional(),
        countSource: z.enum(["person", "machine"]).optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);

    const updated = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(batches).where(eq(batches.id, id));
      if (!before) return null;
      const [after] = await tx
        .update(batches)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(batches.id, id))
        .returning();
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "batches",
        entityId: id,
        action: "update",
        oldValues: before,
        newValues: after,
      });
      return after;
    });

    if (!updated) return reply.code(404).send({ error: "No encontrado" });
    return fichaDelLote(id);
  });

  // --- Ensayos -------------------------------------------------------------

  const ensayoSchema = z.object({
    testedAt: z.coerce.date().optional(),
    ageDays: z.number().int().positive(),
    specimens: z.number().int().positive().default(1),
    strengthMpaMilli: z.number().int().positive(),
    /** Sin criterio de área un MPa no significa nada. Por eso no tiene default. */
    basis: z.enum(["net", "gross"]),
    source: z.enum(["plant", "lab"]).default("plant"),
    notes: z.string().optional(),
  });

  app.post("/bloques/lotes/:id/ensayos", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = ensayoSchema.parse(req.body);

    const [lote] = await db.select().from(batches).where(eq(batches.id, id));
    if (!lote) return reply.code(404).send({ error: "Lote no encontrado" });

    const res = await leerResolver();
    const edadEsperada = res.numero("proceso.edad_ensayo");

    await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(tests)
        .values({
          batchId: id,
          testedAt: body.testedAt ?? new Date(),
          ageDays: body.ageDays,
          specimens: body.specimens,
          strengthMpaMilli: body.strengthMpaMilli,
          basis: body.basis,
          source: body.source,
          readingSource: "person",
          notes: body.notes,
          createdBy: getUserId(req),
        })
        .returning();
      if (!t) throw new Error("No se pudo registrar el ensayo");
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "tests",
        entityId: t.id,
        action: "create",
        newValues: t,
      });
    });

    const ficha = await fichaDelLote(id);
    return reply.code(201).send({
      ...ficha,
      /** Un ensayo antes de tiempo no es inválido, pero no es comparable a la norma. */
      avisoEdad:
        body.ageDays < edadEsperada
          ? `El ensayo se hizo a los ${body.ageDays} días y la norma fija la resistencia a los ${edadEsperada}.`
          : null,
    });
  });

  app.get("/bloques/lotes/:id/ensayos", async (req) => {
    const { id } = req.params as { id: string };
    return db.select().from(tests).where(eq(tests.batchId, id)).orderBy(desc(tests.testedAt));
  });

  // --- La orden del día ----------------------------------------------------

  /**
   * Lo que la pantalla de planta necesita al abrir: qué recetas se pueden
   * correr y cuántos bloques espera cada una. En la fase 1 el software es la
   * orden de trabajo, así que esto es lo primero que ve el operario.
   */
  app.get("/bloques/orden-del-dia", async () => {
    const recetasDisponibles = await db
      .select({
        id: recipes.id,
        code: recipes.code,
        name: recipes.name,
        status: recipes.status,
        expectedBlocksPerMix: recipes.expectedBlocksPerMix,
        tipoBloque: blockTypes.name,
        tipoCodigo: blockTypes.code,
      })
      .from(recipes)
      .leftJoin(blockTypes, eq(recipes.blockTypeId, blockTypes.id))
      .where(and(isNull(recipes.deletedAt), eq(recipes.status, "validated")))
      .orderBy(recipes.name);

    const enCurso = await db
      .select()
      .from(batches)
      .where(isNull(batches.deletedAt))
      .orderBy(desc(batches.producedAt))
      .limit(1);

    return { recetas: recetasDisponibles, ultimoLote: enCurso[0] ?? null };
  });
}
