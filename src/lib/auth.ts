import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "../db/client.js";
import { sessions, users } from "../db/schema.js";

export const COOKIE = "titan_sesion";

/** Los tres niveles, del que más puede al que menos. */
export type Rol = "owner" | "staff" | "viewer";

export type Quien = {
  id: string;
  name: string;
  email: string;
  role: Rol;
  sessionId: string;
};

declare module "fastify" {
  interface FastifyRequest {
    /** Quién hizo esta petición. Lo pone la guarda; nunca lo manda el cliente. */
    quien?: Quien;
  }
}

/**
 * De la llave solo se guarda su huella.
 *
 * La llave viaja en la cookie del navegador y nunca se escribe en la base.
 * Así, quien llegue a leer la tabla de sesiones —un respaldo que se traspapela,
 * alguien mirando la base por encima del hombro— encuentra huellas que no
 * abren nada, no llaves que sí.
 */
const huella = (llave: string) => createHash("sha256").update(llave).digest("hex");

/** Cuántos fallos seguidos antes de trabar, y por cuánto. */
const FALLOS_PERMITIDOS = 5;
const TRABA_MINUTOS = 10;

export async function crearSesion(
  userId: string,
  userAgent: string | undefined,
  reply: FastifyReply,
): Promise<void> {
  // 32 bytes al azar: no se adivina ni probando durante años.
  const llave = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    userId,
    tokenHash: huella(llave),
    userAgent: userAgent?.slice(0, 200) ?? null,
  });

  reply.setCookie(COOKIE, llave, {
    httpOnly: true, // el JavaScript de la página no la puede leer
    sameSite: "lax", // otro sitio no la puede usar para actuar en tu nombre
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Un año. La sesión dura hasta que se cierre, como se pidió; el límite
    // está en el servidor, que puede revocarla, no en el navegador.
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function cerrarSesion(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const llave = req.cookies?.[COOKIE];
  if (llave) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.tokenHash, huella(llave)));
  }
  reply.clearCookie(COOKIE, { path: "/" });
}

/** Quién viene en esta petición, o null si no viene nadie. */
export async function quienViene(req: FastifyRequest): Promise<Quien | null> {
  const llave = req.cookies?.[COOKIE];
  if (!llave) return null;

  const [fila] = await db
    .select({
      sessionId: sessions.id,
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      active: users.active,
      deletedAt: users.deletedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, huella(llave)), isNull(sessions.revokedAt)));

  if (!fila) return null;
  // Desactivar o borrar a alguien tiene que echarlo ya, no cuando se le
  // ocurra cerrar sesión.
  if (!fila.active || fila.deletedAt) return null;

  // Sirve para que la dueña vea cuál de sus sesiones sigue en uso.
  void db
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.id, fila.sessionId))
    .catch(() => {});

  return {
    id: fila.id,
    name: fila.name,
    email: fila.email,
    role: fila.role as Rol,
    sessionId: fila.sessionId,
  };
}

type Intento =
  | { ok: true; userId: string }
  | { ok: false; motivo: string };

/**
 * Verifica una contraseña o un PIN, llevando la cuenta de los fallos.
 *
 * El mensaje de error es el mismo se equivoque en el correo o en la
 * contraseña. Decir «ese correo no existe» le confirma a un desconocido qué
 * correos sí existen, y eso es media respuesta regalada.
 */
export async function verificar(
  identificador: { email: string } | { userId: string },
  secreto: string,
  cual: "password" | "pin",
): Promise<Intento> {
  const [u] = await db
    .select()
    .from(users)
    .where(
      "email" in identificador
        ? eq(users.email, identificador.email.trim().toLowerCase())
        : eq(users.id, identificador.userId),
    );

  const generico =
    cual === "password"
      ? "Ese correo o esa contraseña no coinciden."
      : "Ese PIN no coincide.";

  if (!u || !u.active || u.deletedAt) return { ok: false, motivo: generico };

  if (u.lockedUntil && u.lockedUntil > new Date()) {
    const faltan = Math.ceil((u.lockedUntil.getTime() - Date.now()) / 60000);
    return {
      ok: false,
      motivo: `La cuenta está trabada por varios intentos fallidos. Volvé a probar en ${faltan} minuto${faltan === 1 ? "" : "s"}.`,
    };
  }

  const guardado = cual === "password" ? u.passwordHash : u.pinHash;
  if (!guardado) return { ok: false, motivo: generico };

  if (!(await bcrypt.compare(secreto, guardado))) {
    const fallos = u.failedAttempts + 1;
    await db
      .update(users)
      .set({
        failedAttempts: fallos,
        lockedUntil:
          fallos >= FALLOS_PERMITIDOS
            ? new Date(Date.now() + TRABA_MINUTOS * 60_000)
            : u.lockedUntil,
      })
      .where(eq(users.id, u.id));

    if (fallos >= FALLOS_PERMITIDOS) {
      return {
        ok: false,
        motivo: `Varios intentos fallidos seguidos. La cuenta queda trabada ${TRABA_MINUTOS} minutos.`,
      };
    }
    return { ok: false, motivo: generico };
  }

  if (u.failedAttempts > 0 || u.lockedUntil) {
    await db
      .update(users)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(eq(users.id, u.id));
  }
  return { ok: true, userId: u.id };
}
