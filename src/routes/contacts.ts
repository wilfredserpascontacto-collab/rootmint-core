import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { contacts } from "../db/schema.js";
import { logActivity } from "../lib/activity-log.js";
import { getUserId } from "../lib/request-context.js";

const createSchema = z.object({
  customerId: z.string().uuid(),
  name: z.string().min(1),
  position: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  isPrimary: z.boolean().optional(),
});

const updateSchema = createSchema.partial().omit({ customerId: true });

export async function contactsRoutes(app: FastifyInstance) {
  app.get("/contacts", async (req) => {
    const { customerId, includeInactive } = req.query as {
      customerId?: string;
      includeInactive?: string;
    };
    const conditions = [
      ...(customerId ? [eq(contacts.customerId, customerId)] : []),
      ...(includeInactive === "true" ? [] : [isNull(contacts.deletedAt)]),
    ];
    return db
      .select()
      .from(contacts)
      .where(conditions.length ? and(...conditions) : undefined);
  });

  app.get("/contacts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db.select().from(contacts).where(eq(contacts.id, id));
    if (!row) return reply.code(404).send({ error: "No encontrado" });
    return row;
  });

  app.post("/contacts", async (req, reply) => {
    const body = createSchema.parse(req.body);

    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(contacts)
        .values({ ...body, createdBy: getUserId(req) })
        .returning();
      if (!row) throw new Error("No se pudo crear el contacto");

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "contacts",
        entityId: row.id,
        action: "create",
        newValues: row,
      });
      return row;
    });

    return reply.code(201).send(created);
  });

  app.patch("/contacts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);

    const updated = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(contacts)
        .where(eq(contacts.id, id));
      if (!before) return null;

      const [after] = await tx
        .update(contacts)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(contacts.id, id))
        .returning();
      if (!after) throw new Error("No se pudo actualizar el contacto");

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "contacts",
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

  app.delete("/contacts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };

    const deleted = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)));
      if (!before) return null;

      const [after] = await tx
        .update(contacts)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(contacts.id, id))
        .returning();

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "contacts",
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
