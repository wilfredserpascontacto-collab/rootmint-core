import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { catalogItems } from "../db/schema.js";
import { logActivity } from "../lib/activity-log.js";
import { getUserId } from "../lib/request-context.js";

const createSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(["service", "product"]),
  unit: z.string().min(1),
  unitPriceCents: z.number().int().nonnegative(),
  category: z.string().optional(),
});

const updateSchema = createSchema.partial().extend({
  active: z.boolean().optional(),
});

export async function catalogItemsRoutes(app: FastifyInstance) {
  app.get("/catalog-items", async (req) => {
    const includeInactive = (req.query as { includeInactive?: string })
      .includeInactive === "true";
    return db
      .select()
      .from(catalogItems)
      .where(includeInactive ? undefined : isNull(catalogItems.deletedAt));
  });

  app.get("/catalog-items/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.id, id));
    if (!row) return reply.code(404).send({ error: "No encontrado" });
    return row;
  });

  app.post("/catalog-items", async (req, reply) => {
    const body = createSchema.parse(req.body);

    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(catalogItems)
        .values({ ...body, createdBy: getUserId(req) })
        .returning();
      if (!row) throw new Error("No se pudo crear el ítem de catálogo");

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "catalog_items",
        entityId: row.id,
        action: "create",
        newValues: row,
      });
      return row;
    });

    return reply.code(201).send(created);
  });

  app.patch("/catalog-items/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);

    const updated = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(catalogItems)
        .where(eq(catalogItems.id, id));
      if (!before) return null;

      const [after] = await tx
        .update(catalogItems)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(catalogItems.id, id))
        .returning();
      if (!after) throw new Error("No se pudo actualizar el ítem");

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "catalog_items",
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

  app.delete("/catalog-items/:id", async (req, reply) => {
    const { id } = req.params as { id: string };

    const deleted = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(catalogItems)
        .where(and(eq(catalogItems.id, id), isNull(catalogItems.deletedAt)));
      if (!before) return null;

      const [after] = await tx
        .update(catalogItems)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(catalogItems.id, id))
        .returning();

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "catalog_items",
        entityId: id,
        action: "delete",
        oldValues: before,
      });
      return after;
    });

    if (!deleted) return reply.code(404).send({ error: "No encontrado" });
    return reply.code(204).send();
  });
}
