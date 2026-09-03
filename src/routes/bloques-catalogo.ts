/**
 * Catálogo y ajustes del módulo de bloques.
 *
 * Unidades, materiales, tipos de bloque y la tabla settings — que guarda
 * ÚNICAMENTE lo que el cliente cambió respecto del valor de fábrica.
 */

import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { units, materials, blockTypes, settings } from "../db/schema-bloques.js";
import { logActivity } from "../lib/activity-log.js";
import { getUserId } from "../lib/request-context.js";
import { areasDe, RANGOS_FABRICA, PROCESO_FABRICA } from "../bloques/defaults.js";
import { ajustesResueltos } from "../bloques/servicio.js";

const unidadSchema = z.object({
  name: z.string().min(1),
  abbreviation: z.string().min(1),
  kind: z.enum(["mass", "volume", "count"]),
  factorMilli: z.number().int().positive(),
});

const materialSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.string().optional(),
  purchaseUnit: z.string().min(1),
  purchasePriceCents: z.number().int().nonnegative().default(0),
  dosingUnitId: z.string().uuid().optional(),
  contentPerPurchaseMilli: z.number().int().positive().default(1000),
  bulkDensityKgM3: z.number().int().positive().optional(),
});

const huecoSchema = z.object({
  count: z.number().int().positive(),
  lengthMm: z.number().int().positive(),
  widthMm: z.number().int().positive(),
});

const tipoBloqueSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  lengthMm: z.number().int().positive(),
  heightMm: z.number().int().positive(),
  widthMm: z.number().int().positive(),
  holes: z.array(huecoSchema).optional(),
  /** Si el cliente las manda, mandan las suyas: sus moldes son el dato bueno. */
  grossAreaMm2: z.number().int().positive().optional(),
  netAreaMm2: z.number().int().positive().optional(),
  targetStrengthMpaMilli: z.number().int().positive().optional(),
  targetStrengthBasis: z.enum(["net", "gross"]).optional(),
});

export async function bloquesCatalogoRoutes(app: FastifyInstance) {
  // --- Unidades ------------------------------------------------------------

  app.get("/bloques/unidades", async () =>
    db.select().from(units).where(isNull(units.deletedAt)).orderBy(units.name),
  );

  app.post("/bloques/unidades", async (req, reply) => {
    const body = unidadSchema.parse(req.body);
    const row = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(units)
        .values({ ...body, isCustom: true, createdBy: getUserId(req) })
        .returning();
      if (!u) throw new Error("No se pudo crear la unidad");
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "units",
        entityId: u.id,
        action: "create",
        newValues: u,
      });
      return u;
    });
    return reply.code(201).send(row);
  });

  // --- Materiales ----------------------------------------------------------

  app.get("/bloques/materiales", async () =>
    db
      .select({
        id: materials.id,
        code: materials.code,
        name: materials.name,
        category: materials.category,
        purchaseUnit: materials.purchaseUnit,
        purchasePriceCents: materials.purchasePriceCents,
        dosingUnitId: materials.dosingUnitId,
        contentPerPurchaseMilli: materials.contentPerPurchaseMilli,
        bulkDensityKgM3: materials.bulkDensityKgM3,
        active: materials.active,
        unidadDosificacion: units.abbreviation,
      })
      .from(materials)
      .leftJoin(units, eq(materials.dosingUnitId, units.id))
      .where(isNull(materials.deletedAt))
      .orderBy(materials.name),
  );

  app.post("/bloques/materiales", async (req, reply) => {
    const body = materialSchema.parse(req.body);
    const row = await db.transaction(async (tx) => {
      const [m] = await tx
        .insert(materials)
        .values({ ...body, createdBy: getUserId(req) })
        .returning();
      if (!m) throw new Error("No se pudo crear el material");
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "materials",
        entityId: m.id,
        action: "create",
        newValues: m,
      });
      return m;
    });
    return reply.code(201).send(row);
  });

  /**
   * Cambiar el precio de un material NO recalcula ningún lote ya cerrado:
   * cada lote guardó el precio del día en batch_lines. Un lote de agosto
   * tiene que seguir costando lo que costó en agosto.
   */
  app.patch("/bloques/materiales/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = materialSchema.partial().extend({ active: z.boolean().optional() }).parse(req.body);

    const updated = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(materials).where(eq(materials.id, id));
      if (!before) return null;
      const [after] = await tx
        .update(materials)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(materials.id, id))
        .returning();
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "materials",
        entityId: id,
        action: "update",
        oldValues: before,
        newValues: after,
      });
      return after;
    });

    if (!updated) return reply.code(404).send({ error: "No encontrado" });
    return updated;
  });

  app.delete("/bloques/materiales/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(materials)
        .where(and(eq(materials.id, id), isNull(materials.deletedAt)));
      if (!before) return null;
      const [after] = await tx
        .update(materials)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(materials.id, id))
        .returning();
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "materials",
        entityId: id,
        action: "delete",
        oldValues: before,
      });
      return after;
    });
    if (!row) return reply.code(404).send({ error: "No encontrado" });
    return reply.code(204).send();
  });

  // --- Tipos de bloque -----------------------------------------------------

  app.get("/bloques/tipos", async () =>
    db.select().from(blockTypes).where(isNull(blockTypes.deletedAt)).orderBy(blockTypes.code),
  );

  app.post("/bloques/tipos", async (req, reply) => {
    const body = tipoBloqueSchema.parse(req.body);
    const areas = areasDe(body);
    const row = await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(blockTypes)
        .values({
          ...body,
          holes: body.holes ?? null,
          grossAreaMm2: body.grossAreaMm2 ?? areas.grossAreaMm2,
          netAreaMm2: body.netAreaMm2 ?? areas.netAreaMm2,
          createdBy: getUserId(req),
        })
        .returning();
      if (!t) throw new Error("No se pudo crear el tipo de bloque");
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "block_types",
        entityId: t.id,
        action: "create",
        newValues: t,
      });
      return t;
    });
    return reply.code(201).send(row);
  });

  // --- Ajustes -------------------------------------------------------------

  /**
   * Devuelve TODOS los ajustes con su valor vigente, si lo puso el cliente o
   * viene de fábrica, y la norma que queda dibujada detrás.
   */
  app.get("/bloques/ajustes", async () => ajustesResueltos());

  const rangoBody = z.object({ min: z.number(), max: z.number() });

  app.put("/bloques/ajustes/:key", async (req, reply) => {
    const { key } = req.params as { key: string };
    const esRango = key in RANGOS_FABRICA;
    const esNumero = key in PROCESO_FABRICA;
    if (!esRango && !esNumero) {
      return reply.code(404).send({ error: `Ajuste desconocido: ${key}` });
    }

    const valor = esRango
      ? rangoBody.parse(req.body)
      : z.object({ valor: z.number() }).parse(req.body).valor;

    if (esRango) {
      const r = valor as z.infer<typeof rangoBody>;
      if (r.min > r.max) {
        return reply.code(400).send({ error: "El mínimo no puede ser mayor que el máximo" });
      }
    }

    const row = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(settings).where(eq(settings.key, key));
      const [after] = await tx
        .insert(settings)
        .values({ key, value: valor, setBy: getUserId(req), setAt: new Date() })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: valor, setBy: getUserId(req), setAt: new Date() },
        })
        .returning();
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "settings",
        entityId: key,
        action: before ? "update" : "create",
        oldValues: before ?? null,
        newValues: after,
      });
      return after;
    });

    return row;
  });

  /** Volver al valor de fábrica = borrar el ajuste, no copiar el de fábrica. */
  app.delete("/bloques/ajustes/:key", async (req, reply) => {
    const { key } = req.params as { key: string };
    const row = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(settings).where(eq(settings.key, key));
      if (!before) return null;
      await tx.delete(settings).where(eq(settings.key, key));
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "settings",
        entityId: key,
        action: "delete",
        oldValues: before,
      });
      return before;
    });
    if (!row) return reply.code(404).send({ error: "Ese ajuste ya estaba en el valor de fábrica" });
    return reply.code(204).send();
  });
}
