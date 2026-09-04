/**
 * Puestos, tareas de mantenimiento y su cumplimiento.
 *
 * Una tarea vencida NO bloquea la produccion, igual que una advertencia de
 * mezcla no bloquea una receta. El sistema avisa y deja constancia; quien
 * decide es la planta. Lo que si hace es dejar escrito en el lote que se
 * corrio con el mantenimiento vencido, para que esa pista exista despues.
 */

import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { plantRoles, maintenanceTasks, maintenanceLogs } from "../db/schema-bloques.js";
import { logActivity } from "../lib/activity-log.js";
import { getUserId } from "../lib/request-context.js";
import { contadores, tareasConEstado } from "../bloques/mantenimiento.js";

const puestoSchema = z.object({
  code: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});

/** Los topes: ver la nota en bloques-produccion.ts. */
const tareaSchema = z
  .object({
    code: z.string().min(1).max(60),
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    roleId: z.string().uuid().nullable().optional(),
    everyMixes: z.number().int().positive().max(1_000_000).nullable().optional(),
    everyBatches: z.number().int().positive().max(1_000_000).nullable().optional(),
  })
  .refine((t) => !!t.everyMixes !== !!t.everyBatches, {
    message: "Una tarea se mide por mezclas O por lotes, no por las dos ni por ninguna",
  });

export async function bloquesMantenimientoRoutes(app: FastifyInstance) {
  // --- Puestos -------------------------------------------------------------

  app.get("/bloques/puestos", async () =>
    db.select().from(plantRoles).where(isNull(plantRoles.deletedAt)).orderBy(plantRoles.name),
  );

  app.post("/bloques/puestos", async (req, reply) => {
    const body = puestoSchema.parse(req.body);
    const row = await db.transaction(async (tx) => {
      const [p] = await tx
        .insert(plantRoles)
        .values({ ...body, createdBy: getUserId(req) })
        .returning();
      if (!p) throw new Error("No se pudo crear el puesto");
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "plant_roles",
        entityId: p.id,
        action: "create",
        newValues: p,
      });
      return p;
    });
    return reply.code(201).send(row);
  });

  app.patch("/bloques/puestos/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = puestoSchema.partial().extend({ active: z.boolean().optional() }).parse(req.body);
    const [row] = await db
      .update(plantRoles)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(plantRoles.id, id))
      .returning();
    if (!row) return reply.code(404).send({ error: "No encontrado" });
    return row;
  });

  app.delete("/bloques/puestos/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db
      .update(plantRoles)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(plantRoles.id, id), isNull(plantRoles.deletedAt)))
      .returning();
    if (!row) return reply.code(404).send({ error: "No encontrado" });
    return reply.code(204).send();
  });

  // --- Tareas --------------------------------------------------------------

  /** El tablero: cada tarea con cuanto lleva de uso y si esta vencida. */
  app.get("/bloques/mantenimiento", async () => {
    const c = await contadores();
    const tareas = await tareasConEstado(c);
    return {
      contadores: c,
      tareas,
      resumen: {
        vencidas: tareas.filter((t) => t.estado === "vencida").length,
        porVencer: tareas.filter((t) => t.estado === "por vencer").length,
        total: tareas.length,
      },
    };
  });

  app.post("/bloques/mantenimiento/tareas", async (req, reply) => {
    const body = tareaSchema.parse(req.body);
    const row = await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(maintenanceTasks)
        .values({
          code: body.code,
          name: body.name,
          description: body.description,
          roleId: body.roleId ?? null,
          everyMixes: body.everyMixes ?? null,
          everyBatches: body.everyBatches ?? null,
          isCustom: true,
          createdBy: getUserId(req),
        })
        .returning();
      if (!t) throw new Error("No se pudo crear la tarea");
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "maintenance_tasks",
        entityId: t.id,
        action: "create",
        newValues: t,
      });
      return t;
    });
    return reply.code(201).send(row);
  });

  /**
   * Cambiar el intervalo o el puesto de una tarea. Los intervalos de fabrica
   * son un punto de partida, no una verdad: el manual de la maquina manda.
   */
  app.patch("/bloques/mantenimiento/tareas/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        roleId: z.string().uuid().nullable().optional(),
        everyMixes: z.number().int().positive().nullable().optional(),
        everyBatches: z.number().int().positive().nullable().optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);

    const updated = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(maintenanceTasks).where(eq(maintenanceTasks.id, id));
      if (!before) return null;

      const everyMixes = body.everyMixes !== undefined ? body.everyMixes : before.everyMixes;
      const everyBatches =
        body.everyBatches !== undefined ? body.everyBatches : before.everyBatches;
      if (!!everyMixes === !!everyBatches) {
        throw Object.assign(new Error("Una tarea se mide por mezclas O por lotes"), {
          statusCode: 400,
        });
      }

      const [after] = await tx
        .update(maintenanceTasks)
        .set({ ...body, everyMixes, everyBatches, updatedAt: new Date() })
        .where(eq(maintenanceTasks.id, id))
        .returning();

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "maintenance_tasks",
        entityId: id,
        action: "update",
        oldValues: before,
        newValues: after,
      });
      return after;
    });

    if (!updated) return reply.code(404).send({ error: "No encontrada" });
    return updated;
  });

  app.delete("/bloques/mantenimiento/tareas/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [before] = await db.select().from(maintenanceTasks).where(eq(maintenanceTasks.id, id));
    if (!before) return reply.code(404).send({ error: "No encontrada" });
    if (!before.isCustom) {
      /** Las de fabrica se desactivan, no se borran: asi una mejora nuestra puede volver. */
      const [row] = await db
        .update(maintenanceTasks)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(maintenanceTasks.id, id))
        .returning();
      return { ...row, aviso: "Es una tarea de fábrica: quedó desactivada, no borrada." };
    }
    await db
      .update(maintenanceTasks)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(maintenanceTasks.id, id));
    return reply.code(204).send();
  });

  // --- Cumplimiento --------------------------------------------------------

  /**
   * "Ya la hice." Congela los contadores del momento, que es lo unico que
   * permite despues calcular cuanto se lleva usado desde entonces.
   */
  app.post("/bloques/mantenimiento/tareas/:id/hecha", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({ notes: z.string().optional(), roleId: z.string().uuid().optional() })
      .parse(req.body ?? {});

    const [tarea] = await db.select().from(maintenanceTasks).where(eq(maintenanceTasks.id, id));
    if (!tarea) return reply.code(404).send({ error: "No encontrada" });

    const c = await contadores();

    const puestoId = body.roleId ?? tarea.roleId;
    const puesto = puestoId
      ? (await db.select().from(plantRoles).where(eq(plantRoles.id, puestoId)))[0]
      : undefined;

    await db.transaction(async (tx) => {
      const [log] = await tx
        .insert(maintenanceLogs)
        .values({
          taskId: id,
          doneAt: new Date(),
          atMixes: c.mezclas,
          atBatches: c.lotes,
          roleName: puesto?.name ?? null,
          notes: body.notes,
          createdBy: getUserId(req),
        })
        .returning();
      if (!log) throw new Error("No se pudo registrar");
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "maintenance_logs",
        entityId: log.id,
        action: "create",
        newValues: log,
      });
    });

    const tareas = await tareasConEstado();
    return reply.code(201).send({
      contadores: c,
      tarea: tareas.find((t) => t.id === id) ?? null,
    });
  });

  app.get("/bloques/mantenimiento/tareas/:id/historial", async (req) => {
    const { id } = req.params as { id: string };
    return db
      .select()
      .from(maintenanceLogs)
      .where(eq(maintenanceLogs.taskId, id))
      .orderBy(maintenanceLogs.doneAt);
  });
}
