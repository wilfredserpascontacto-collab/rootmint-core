import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { logActivity } from "../lib/activity-log.js";
import { getUserId } from "../lib/request-context.js";

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["owner", "staff", "viewer"]).default("staff"),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: z.enum(["owner", "staff", "viewer"]).optional(),
  active: z.boolean().optional(),
});

function toPublicUser(user: typeof users.$inferSelect) {
  const { passwordHash, ...rest } = user;
  return rest;
}

export async function usersRoutes(app: FastifyInstance) {
  app.get("/users", async (req) => {
    const includeInactive = (req.query as { includeInactive?: string })
      .includeInactive === "true";
    const rows = await db
      .select()
      .from(users)
      .where(includeInactive ? undefined : isNull(users.deletedAt));
    return rows.map(toPublicUser);
  });

  app.get("/users/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db.select().from(users).where(eq(users.id, id));
    if (!row) return reply.code(404).send({ error: "No encontrado" });
    return toPublicUser(row);
  });

  app.post("/users", async (req, reply) => {
    const body = createSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(body.password, 10);

    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          name: body.name,
          email: body.email,
          passwordHash,
          role: body.role,
        })
        .returning();
      if (!row) throw new Error("No se pudo crear el usuario");

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "users",
        entityId: row.id,
        action: "create",
        newValues: toPublicUser(row),
      });
      return row;
    });

    return reply.code(201).send(toPublicUser(created));
  });

  app.patch("/users/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);

    const updated = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(users).where(eq(users.id, id));
      if (!before) return null;

      const patch: Partial<typeof users.$inferInsert> = {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.email !== undefined && { email: body.email }),
        ...(body.role !== undefined && { role: body.role }),
        ...(body.active !== undefined && { active: body.active }),
        ...(body.password !== undefined && {
          passwordHash: await bcrypt.hash(body.password, 10),
        }),
        updatedAt: new Date(),
      };

      const [after] = await tx
        .update(users)
        .set(patch)
        .where(eq(users.id, id))
        .returning();
      if (!after) throw new Error("No se pudo actualizar el usuario");

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "users",
        entityId: id,
        action: "update",
        oldValues: toPublicUser(before),
        newValues: toPublicUser(after),
      });
      return after;
    });

    if (!updated) return reply.code(404).send({ error: "No encontrado" });
    return toPublicUser(updated);
  });

  app.delete("/users/:id", async (req, reply) => {
    const { id } = req.params as { id: string };

    const deleted = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)));
      if (!before) return null;

      const [after] = await tx
        .update(users)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "users",
        entityId: id,
        action: "delete",
        oldValues: toPublicUser(before),
      });
      return after;
    });

    if (!deleted) return reply.code(404).send({ error: "No encontrado" });
    return reply.code(204).send();
  });
}
