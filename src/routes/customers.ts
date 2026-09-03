import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { customers } from "../db/schema.js";
import { logActivity } from "../lib/activity-log.js";
import { getUserId } from "../lib/request-context.js";

const createSchema = z.object({
  type: z.enum(["person", "company"]),
  name: z.string().min(1),
  nit: z.string().optional(),
  nrc: z.string().optional(),
  giro: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  municipality: z.string().optional(),
  department: z.string().optional(),
  notes: z.string().optional(),
});

const updateSchema = createSchema.partial().extend({
  active: z.boolean().optional(),
});

export async function customersRoutes(app: FastifyInstance) {
  app.get("/customers", async (req) => {
    const includeInactive = (req.query as { includeInactive?: string })
      .includeInactive === "true";
    return db
      .select()
      .from(customers)
      .where(includeInactive ? undefined : isNull(customers.deletedAt));
  });

  app.get("/customers/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, id));
    if (!row) return reply.code(404).send({ error: "No encontrado" });
    return row;
  });

  app.post("/customers", async (req, reply) => {
    const body = createSchema.parse(req.body);

    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(customers)
        .values({ ...body, createdBy: getUserId(req) })
        .returning();
      if (!row) throw new Error("No se pudo crear el cliente");

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "customers",
        entityId: row.id,
        action: "create",
        newValues: row,
      });
      return row;
    });

    return reply.code(201).send(created);
  });

  app.patch("/customers/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);

    const updated = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(customers)
        .where(eq(customers.id, id));
      if (!before) return null;

      const [after] = await tx
        .update(customers)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(customers.id, id))
        .returning();
      if (!after) throw new Error("No se pudo actualizar el cliente");

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "customers",
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

  app.delete("/customers/:id", async (req, reply) => {
    const { id } = req.params as { id: string };

    const deleted = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.id, id), isNull(customers.deletedAt)));
      if (!before) return null;

      const [after] = await tx
        .update(customers)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(customers.id, id))
        .returning();

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "customers",
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
