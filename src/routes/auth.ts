import { modulosActivos } from "../modulos.js";
import { marcaDelDespliegue } from "../marca.js";
import type { FastifyInstance } from "fastify";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { cerrarSesion, crearSesion, verificar } from "../lib/auth.js";
import { logActivity } from "../lib/activity-log.js";

const entrarSchema = z.object({
  email: z.string().email("Eso no parece un correo."),
  password: z.string().min(1, "Falta la contraseña."),
});

const pinSchema = z.object({
  userId: z.string().uuid(),
  pin: z.string().min(4, "El PIN lleva al menos 4 dígitos."),
});

const primeraSchema = z.object({
  name: z.string().min(1, "Falta el nombre."),
  email: z.string().email("Eso no parece un correo."),
  password: z.string().min(8, "La contraseña necesita al menos 8 caracteres."),
});

export async function authRoutes(app: FastifyInstance) {
  /** Quién soy. La interfaz pregunta esto al abrir para saber qué mostrar. */
  app.get("/auth/me", async (req, reply) => {
    if (!req.quien) return reply.code(401).send({ error: "No hay sesión." });
    const { sessionId: _, ...persona } = req.quien;
    // Que piezas tiene este despliegue: la interfaz arma el menu con esto.
    return { ...persona, modulos: modulosActivos(), ...(await marcaDelDespliegue()) };
  });

  /**
   * Si no hay ninguna dueña todavía, hay que poder crear la primera.
   *
   * La condición es "no hay dueña activa", no "no hay ningún usuario", y la
   * diferencia importa: la semilla de demostración deja creado un usuario de
   * planta. Con la condición ingenua, una base sembrada nacía sin dueña y sin
   * forma de nombrar una — nadie podría entrar a administrar nunca más.
   *
   * Es una ventana angosta y hay que cruzarla apenas se publica: mientras
   * esté abierta, quien llegue primero a la dirección se queda con la cuenta.
   * Se cierra sola en cuanto existe una dueña, y desde ahí no se puede quitar
   * a la última.
   */
  const hayDuena = async () => {
    const [alguna] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "owner"), eq(users.active, true), isNull(users.deletedAt)))
      .limit(1);
    return Boolean(alguna);
  };

  // Abierta: la pantalla de entrada necesita saber como se llama el sistema
  // antes de que nadie haya entrado.
  app.get("/auth/hay-alguien", async () => ({ hayAlguien: await hayDuena(), planta: modulosActivos().includes("bloques"), ...(await marcaDelDespliegue()) }));

  app.post("/auth/primera-duena", async (req, reply) => {
    if (await hayDuena()) {
      return reply.code(409).send({
        error: "Ya hay una dueña. Entrá con tu cuenta o pedile a ella que te cree una.",
      });
    }

    const body = primeraSchema.parse(req.body);
    const [creada] = await db
      .insert(users)
      .values({
        name: body.name.trim(),
        email: body.email.trim().toLowerCase(),
        passwordHash: await bcrypt.hash(body.password, 10),
        role: "owner",
      })
      .returning();
    if (!creada) throw new Error("No se pudo crear la cuenta.");

    await crearSesion(creada.id, req.headers["user-agent"], reply);
    await logActivity(db, { userId: creada.id, action: "primera-duena", entity: "users", entityId: creada.id });
    return reply.code(201).send({ id: creada.id, name: creada.name, email: creada.email, role: creada.role });
  });

  /** Entrar desde la oficina: correo y contraseña. */
  app.post("/auth/entrar", async (req, reply) => {
    const body = entrarSchema.parse(req.body);
    const intento = await verificar({ email: body.email }, body.password, "password");
    if (!intento.ok) return reply.code(401).send({ error: intento.motivo });

    await crearSesion(intento.userId, req.headers["user-agent"], reply);
    await logActivity(db, { userId: intento.userId, action: "entrar", entity: "users", entityId: intento.userId });
    return { ok: true };
  });

  /**
   * Los nombres que aparecen en la tablet de la planta.
   *
   * Sólo nombre e id, y sólo de quien tiene PIN. Hace falta antes de entrar,
   * así que es lo único que se puede pedir sin sesión: quien dé con la
   * dirección verá una lista de nombres de pila. Se prefirió eso a que el
   * operario tenga que teclear su correo con las manos llenas de mezcla.
   */
  app.get("/auth/planta", async () => {
    const filas = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(isNotNull(users.pinHash), eq(users.active, true), isNull(users.deletedAt)));
    return filas;
  });

  app.post("/auth/pin", async (req, reply) => {
    const body = pinSchema.parse(req.body);
    const intento = await verificar({ userId: body.userId }, body.pin, "pin");
    if (!intento.ok) return reply.code(401).send({ error: intento.motivo });

    await crearSesion(intento.userId, req.headers["user-agent"], reply);
    await logActivity(db, { userId: intento.userId, action: "entrar-pin", entity: "users", entityId: intento.userId });
    return { ok: true };
  });

  app.post("/auth/salir", async (req, reply) => {
    await cerrarSesion(req, reply);
    return { ok: true };
  });
}
