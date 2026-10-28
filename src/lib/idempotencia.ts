import { and, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { db as Db } from "../db/client.js";
import { idempotencyKeys } from "../db/schema.js";

type Tx = Pick<typeof Db, "select" | "insert">;

/**
 * Idempotencia: repetir el guardado no crea otro documento.
 *
 * Quien guarda manda una llave en la cabecera `Idempotency-Key`. Si la misma
 * llave vuelve a llegar, no se crea nada nuevo: se devuelve lo que salió la
 * primera vez. Para la secretaria que le dio clic tres veces porque la
 * pantalla se quedó pensando, el resultado es una sola cotización.
 *
 * Sin cabecera todo sigue como antes. Es a propósito: las pruebas viejas y
 * cualquier integración que ya exista no se rompen por esto, y la protección
 * entra sola en cuanto la pantalla manda la llave.
 */
export const CABECERA = "idempotency-key";

export function llaveDe(req: FastifyRequest): string | null {
  const bruto = req.headers[CABECERA];
  const valor = Array.isArray(bruto) ? bruto[0] : bruto;
  if (!valor) return null;
  const limpio = valor.trim();
  if (!limpio) return null;
  // Un tope sano: una llave es un identificador, no un campo de texto.
  if (limpio.length > 200) {
    throw Object.assign(new Error("La llave de guardado es demasiado larga."), { statusCode: 400 });
  }
  return limpio;
}

/** Lo que ya se creó con esta llave, si es que se creó algo. */
export async function yaCreado(
  tx: Tx,
  llave: string | null,
  scope: string,
): Promise<string | null> {
  if (!llave) return null;
  const [fila] = await tx
    .select({ entityId: idempotencyKeys.entityId })
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.key, llave), eq(idempotencyKeys.scope, scope)));
  return fila?.entityId ?? null;
}

/**
 * Deja anotado qué documento salió de esta llave.
 *
 * Va dentro de la transacción del documento. Si dos pedidos con la misma
 * llave entran a la vez, el segundo se queda esperando en la llave única
 * hasta que el primero cierre, y entonces choca: ese choque es la señal de
 * que el documento ya existe, no un error que reportar.
 */
export async function anotar(
  tx: Tx,
  llave: string | null,
  scope: string,
  entityId: string,
  userId: string | null,
): Promise<void> {
  if (!llave) return;
  await tx.insert(idempotencyKeys).values({ key: llave, scope, entityId, userId });
}

/** Una llave repetida se reconoce por el choque de la clave primaria. */
export function esLlaveRepetida(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string }; message?: string };
  const codigo = e?.code ?? e?.cause?.code;
  if (codigo === "23505") return true;
  return typeof e?.message === "string" && /duplicate key value|unique constraint/i.test(e.message);
}

