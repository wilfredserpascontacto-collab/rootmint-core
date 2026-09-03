import type { db as Db } from "../db/client.js";
import { activityLog } from "../db/schema.js";

type Tx = Pick<typeof Db, "insert">;

export async function logActivity(
  tx: Tx,
  params: {
    userId: string | null;
    entity: string;
    entityId: string;
    action: "create" | "update" | "delete";
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
