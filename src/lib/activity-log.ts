import type { db as Db } from "../db/client.js";
import { activityLog } from "../db/schema.js";

type Tx = Pick<typeof Db, "insert">;

export async function logActivity(
  tx: Tx,
  params: {
    userId: string | null;
    entity: string;
    entityId: string;
    /**
     * Qué se hizo. Las tres de siempre sobre un registro, más las
     * entradas y salidas: saber quién anotó un pago pierde la mitad de su
     * valor si no se sabe también quién estaba adentro esa tarde.
     */
    action: "create" | "update" | "delete" | "entrar" | "entrar-pin" | "primera-duena";
    oldValues?: unknown;
    newValues?: unknown;
  },
) {
  await tx.insert(activityLog).values({
    userId: params.userId,
    entity: params.entity,
    entityId: params.entityId,
    action: params.action,
    oldValues: params.oldValues ?? null,
    newValues: params.newValues ?? null,
  });
}
