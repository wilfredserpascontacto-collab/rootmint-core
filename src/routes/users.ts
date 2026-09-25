import type { FastifyInstance } from "fastify";
import { and, eq, isNull, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { logActivity } from "../lib/activity-log.js";
import { getUserId } from "../lib/request-context.js";

/**
 * El PIN de planta: sólo dígitos, de 4 a 8.
 *
 * Se piden dígitos y no cualquier cosa porque en la tablet se teclea en un
 * pad numérico. Y se rechazan los cuatro más obvios: un PIN que cualquiera
 * adivina al primer intento no protege nada, y quien lo elige casi nunca
 * piensa en eso.
 */
const OBVIOS = new Set(["0000", "1111", "1234", "4321", "0123", "00000", "12345", "123456"]);
const pinValido = z
  .string()
  .regex(/^\d{4,8}$/, "El PIN son de 4 a 8 dígitos, sin letras.")
  .refine((v) => !OBVIOS.has(v), "Ese PIN lo adivina cualquiera. Elegí otro.")
  .refine((v) => new Set(v).size > 1, "Un PIN de un solo dígito repetido no sirve.");

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["owner", "staff", "viewer"]).default("staff"),
  /** Opcional: sólo lo lleva quien entra desde la tablet de la planta. */
  pin: pinValido.optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: z.enum(["owner", "staff", "viewer"]).optional(),
  active: z.boolean().optional(),
  /** null quita el PIN y con eso saca a la persona de la lista de la planta. */
  pin: pinValido.nullable().optional(),
});

/**
 * El usuario tal como sale al mundo.
 *
 * Fuera la contraseña y fuera el PIN cifrados: no hay ninguna pantalla que
 * los necesite, y lo que no sale no se filtra. En su lugar va un sí o no, que
 * es lo único que la pantalla de cuentas quiere saber.
 */
function toPublicUser(user: typeof users.$inferSelect) {
  const { passwordHash, pinHash, failedAttempts, lockedUntil, ...rest } = user;
  return {
    ...rest,
    tienePin: Boolean(pinHash),
    trabadaHasta: lockedUntil && lockedUntil > new Date() ? lockedUntil : null,
  };
}


/**
 * ¿Queda alguna dueña además de ésta?
 *
 * Sin esta pregunta, quitarse el propio rol o desactivarse por error deja el
 * sistema sin nadie que pueda crear cuentas ni devolver permisos: se entra,
 * pero ya no hay forma de arreglarlo desde adentro. Es el tipo de error que
 * se comete una sola vez y cuesta una tarde.
 */
async function quedaOtraDuena(id: string): Promise<boolean> {
  const otras = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "owner"),
        eq(users.active, true),
        isNull(users.deletedAt),
        ne(users.id, id),
      ),
    );
  return otras.length > 0;
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
          ...(body.pin !== undefined && { pinHash: await bcrypt.hash(body.pin, 10) }),
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

    const [actual] = await db.select().from(users).where(eq(users.id, id));
    if (!actual) return reply.code(404).send({ error: "No encontrado" });

    const dejaDeSerDuena =
      actual.role === "owner" &&
      ((body.role !== undefined && body.role !== "owner") || body.active === false);
    if (dejaDeSerDuena && !(await quedaOtraDuena(id))) {
      return reply.code(409).send({
        error:
          "Es la única dueña activa. Si le quitás el rol no va a quedar nadie que pueda administrar las cuentas: nombrá antes a otra.",
      });
    }

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
        ...(body.pin !== undefined && {
          pinHash: body.pin === null ? null : await bcrypt.hash(body.pin, 10),
        }),
        // Cambiarle la contraseña o el PIN a alguien lo destraba: es
        // justamente lo que hace una dueña cuando la llaman porque el
        // operario se equivocó cinco veces.
        ...((body.password !== undefined || body.pin !== undefined) && {
          failedAttempts: 0,
          lockedUntil: null,
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

    /**
     * La pregunta va aca afuera, antes de abrir la transaccion.
     *
     * Adentro se colgaba: con una sola conexion, consultar la base mientras
     * hay una transaccion abierta sobre esa misma conexion espera a que
     * termine la transaccion, que a su vez espera la consulta. La peticion
     * quedaba colgada para siempre, sin error y sin respuesta.
     */
    const [quien] = await db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt)));
    if (quien?.role === "owner" && !(await quedaOtraDuena(id))) {
      return reply.code(409).send({
        error:
          "Es la única dueña activa. Si la quitás no va a quedar nadie que pueda administrar las cuentas: nombrá antes a otra.",
      });
    }

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
