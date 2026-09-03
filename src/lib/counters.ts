import { sql } from "drizzle-orm";
import type { db as Db } from "../db/client.js";
import { counters } from "../db/schema.js";

type Tx = Pick<typeof Db, "insert" | "update">;

/**
 * Reserva el siguiente correlativo para `id` (p.ej. "quote") dentro de la
 * transacción `tx`. Usa upsert + increment atómico: nunca lee el valor
 * actual y lo recalcula fuera de la fila, así que dos transacciones
 * concurrentes no pueden reservar el mismo número.
 */
export async function nextCorrelativo(tx: Tx, id: string): Promise<number> {
  const [row] = await tx
    .insert(counters)
    .values({ id, value: 1 })
    .onConflictDoUpdate({
      target: counters.id,
      set: { value: sql`${counters.value} + 1` },
    })
    .returning({ value: counters.value });

  if (!row) {
    throw new Error(`No se pudo reservar correlativo para "${id}"`);
  }
  return row.value;
}
