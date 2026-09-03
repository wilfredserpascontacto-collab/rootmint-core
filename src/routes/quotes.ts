import type { FastifyInstance } from "fastify";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { catalogItems, quoteLines, quotes } from "../db/schema.js";
import { logActivity } from "../lib/activity-log.js";
import { nextCorrelativo } from "../lib/counters.js";
import { getUserId } from "../lib/request-context.js";

const lineInputSchema = z.object({
  catalogItemId: z.string().uuid().optional(),
  // Si se omiten, se toman del catalog_item referenciado. Una vez creada la
  // línea, ambos quedan congelados y ya no cambian aunque el catálogo cambie.
  description: z.string().min(1).optional(),
  unitPriceCents: z.number().int().nonnegative().optional(),
  quantity: z.number().int().positive(),
});

const createSchema = z.object({
  customerId: z.string().uuid(),
  contactId: z.string().uuid().optional(),
  workLocation: z.string().optional(),
  description: z.string().optional(),
  issueDate: z.coerce.date().default(() => new Date()),
  validityDays: z.number().int().positive().default(15),
  taxRatePercent: z.number().min(0).max(100).default(0),
  notes: z.string().optional(),
  terms: z.string().optional(),
  lines: z.array(lineInputSchema).min(1),
});

const statusUpdateSchema = z.object({
  status: z.enum(["draft", "sent", "accepted", "rejected", "expired"]),
});

async function loadQuoteWithLines(quoteId: string) {
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!quote) return null;
  const lines = await db
    .select()
    .from(quoteLines)
    .where(and(eq(quoteLines.quoteId, quoteId), isNull(quoteLines.deletedAt)))
    .orderBy(asc(quoteLines.displayOrder));
  return { ...quote, lines };
}

export async function quotesRoutes(app: FastifyInstance) {
  app.get("/quotes", async (req) => {
    const { customerId, includeInactive } = req.query as {
      customerId?: string;
      includeInactive?: string;
    };
    const conditions = [
      ...(customerId ? [eq(quotes.customerId, customerId)] : []),
      ...(includeInactive === "true" ? [] : [isNull(quotes.deletedAt)]),
    ];
    return db
      .select()
      .from(quotes)
      .where(conditions.length ? and(...conditions) : undefined);
  });

  app.get("/quotes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const quote = await loadQuoteWithLines(id);
    if (!quote) return reply.code(404).send({ error: "No encontrado" });
    return quote;
  });

  app.post("/quotes", async (req, reply) => {
    const body = createSchema.parse(req.body);
    const userId = getUserId(req);

    const created = await db.transaction(async (tx) => {
      // Las líneas sin precio/descripción explícitos los toman del catálogo
      // en este mismo momento; de ahí en adelante quedan congelados.
      const resolvedLines = await Promise.all(
        body.lines.map(async (line) => {
          if (line.description !== undefined && line.unitPriceCents !== undefined) {
            return {
              catalogItemId: line.catalogItemId ?? null,
              description: line.description,
              unitPriceCents: line.unitPriceCents,
              quantity: line.quantity,
            };
          }
          if (!line.catalogItemId) {
            throw new Error(
              "Cada línea necesita catalogItemId, o description y unitPriceCents explícitos",
            );
          }
          const [item] = await tx
            .select()
            .from(catalogItems)
            .where(eq(catalogItems.id, line.catalogItemId));
          if (!item) throw new Error(`catalog_item ${line.catalogItemId} no existe`);
          return {
            catalogItemId: item.id,
            description: line.description ?? item.name,
            unitPriceCents: line.unitPriceCents ?? item.unitPriceCents,
            quantity: line.quantity,
          };
        }),
      );

      const subtotalCents = resolvedLines.reduce(
        (sum, l) => sum + l.unitPriceCents * l.quantity,
        0,
      );
      const taxCents = Math.round((subtotalCents * body.taxRatePercent) / 100);
      const totalCents = subtotalCents + taxCents;

      const number = await nextCorrelativo(tx, "quote");

      const [quote] = await tx
        .insert(quotes)
        .values({
          number,
          customerId: body.customerId,
          contactId: body.contactId,
          workLocation: body.workLocation,
          description: body.description,
          issueDate: body.issueDate,
          validityDays: body.validityDays,
          subtotalCents,
          taxCents,
          totalCents,
          notes: body.notes,
          terms: body.terms,
          createdBy: userId,
        })
        .returning();
      if (!quote) throw new Error("No se pudo crear la cotización");

      const insertedLines = await tx
        .insert(quoteLines)
        .values(
          resolvedLines.map((l, index) => ({
            quoteId: quote.id,
            catalogItemId: l.catalogItemId,
            description: l.description,
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
            subtotalCents: l.unitPriceCents * l.quantity,
            displayOrder: index,
          })),
        )
        .returning();

      await logActivity(tx, {
        userId,
        entity: "quotes",
        entityId: quote.id,
        action: "create",
        newValues: { ...quote, lines: insertedLines },
      });

      return { ...quote, lines: insertedLines };
    });

    return reply.code(201).send(created);
  });

  app.patch("/quotes/:id/status", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = statusUpdateSchema.parse(req.body);
    const userId = getUserId(req);

    const updated = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(quotes).where(eq(quotes.id, id));
      if (!before) return null;

      const [after] = await tx
        .update(quotes)
        .set({ status: body.status, updatedAt: new Date() })
        .where(eq(quotes.id, id))
        .returning();
      if (!after) throw new Error("No se pudo actualizar la cotización");

      await logActivity(tx, {
        userId,
        entity: "quotes",
        entityId: id,
        action: "update",
        oldValues: { status: before.status },
        newValues: { status: after.status },
      });
      return after;
    });

    if (!updated) return reply.code(404).send({ error: "No encontrado" });
    return updated;
  });

  app.delete("/quotes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = getUserId(req);

    const deleted = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(quotes)
        .where(and(eq(quotes.id, id), isNull(quotes.deletedAt)));
      if (!before) return null;

      const [after] = await tx
        .update(quotes)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(quotes.id, id))
        .returning();

      await logActivity(tx, {
        userId,
        entity: "quotes",
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
