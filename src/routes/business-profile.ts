import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { businessProfile } from "../db/schema.js";
import { logActivity } from "../lib/activity-log.js";
import { getUserId } from "../lib/request-context.js";

const input = z.object({
  name: z.string().trim().min(1).max(160),
  address: z.string().max(500).default(""), phone: z.string().max(60).default(""),
  email: z.union([z.literal(""), z.string().email()]).default(""),
  nit: z.string().max(40).default(""), terms: z.string().max(5000).default(""),
});
export async function businessProfileRoutes(app: FastifyInstance) {
  app.get("/business-profile", async () => {
    const [profile] = await db.select().from(businessProfile).where(eq(businessProfile.id, 1));
    return profile ?? { name: "Mi empresa", address: "", phone: "", email: "", nit: "", terms: "" };
  });
  app.put("/business-profile", async (req) => {
    const body = input.parse(req.body);
    return db.transaction(async tx => {
      const [before] = await tx.select().from(businessProfile).where(eq(businessProfile.id, 1));
      const [after] = await tx.insert(businessProfile).values({ ...body, id: 1 })
        .onConflictDoUpdate({ target: businessProfile.id, set: { ...body, updatedAt: new Date() } }).returning();
      await logActivity(tx, { userId: getUserId(req), entity: "business_profile", entityId: "1", action: "update", oldValues: before, newValues: after });
      return after;
    });
  });
}
