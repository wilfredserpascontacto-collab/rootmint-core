import type { FastifyInstance } from "fastify";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { catalogItems, quoteLines, quotes, customers, contacts, businessProfile } from "../db/schema.js";
import { quoteTotals } from "../lib/quote-math.js";
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

const ESTADO_ES: Record<string, string> = {
  draft: "Borrador",
  sent: "Emitida",
  accepted: "Aceptada",
  rejected: "Rechazada",
  expired: "Vencida",
};

/**
 * El camino que sigue una cotización cuando todo va bien.
 *
 * No es una reja: cualquier estado puede ir a cualquier otro. Antes esto era
 * una lista de transiciones permitidas y las de vuelta se rechazaban con un
 * 409. El efecto en la vida real era que una persona tocaba «Marcar como
 * emitida» sin querer y esa cotización quedaba emitida para siempre —
 * tampoco se podía archivar, porque el archivado exigía que fuera borrador.
 * Un sistema donde un clic equivocado no tiene vuelta atrás obliga a la
 * gente a inventar cotizaciones nuevas para tapar la anterior, y entonces
 * los números dejan de querer decir algo.
 *
 * Lo que queda de aquella lista es el aviso: cuando el cambio no sigue el
 * curso natural se devuelve un texto para que la pantalla lo muestre. La
 * bitácora guarda de dónde a dónde se movió y quién lo hizo. Avisar y dejar
 * rastro, no impedir.
 */
const CURSO_NATURAL: Record<string, string[]> = {
  draft: ["sent"],
  sent: ["accepted", "rejected", "expired"],
  accepted: [],
  rejected: [],
  expired: [],
};

async function loadQuoteWithLines(quoteId: string) {
  const [quote] = await db.select().from(quotes).where(and(eq(quotes.id, quoteId), isNull(quotes.deletedAt)));
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
      const [customer] = await tx.select().from(customers).where(and(eq(customers.id, body.customerId), isNull(customers.deletedAt), eq(customers.active, true)));
      if (!customer) throw Object.assign(new Error("Seleccione un cliente activo."), { statusCode: 400 });
      if (body.contactId) {
        const [contact] = await tx.select().from(contacts).where(and(eq(contacts.id, body.contactId), eq(contacts.customerId, customer.id), isNull(contacts.deletedAt)));
        if (!contact) throw Object.assign(new Error("El contacto no pertenece al cliente."), { statusCode: 400 });
      }
      const [profile] = await tx.select().from(businessProfile).where(eq(businessProfile.id, 1));
      // Las líneas sin precio/descripción explícitos los toman del catálogo
      // en este mismo momento; de ahí en adelante quedan congelados.
      const resolvedLines = await Promise.all(
        body.lines.map(async (line) => {
          if (!line.catalogItemId && line.description !== undefined && line.unitPriceCents !== undefined) {
            return {
              catalogItemId: line.catalogItemId ?? null,
              description: line.description,
              unitPriceCents: line.unitPriceCents,
              quantity: line.quantity,
            };
          }
          if (!line.catalogItemId) {
            throw Object.assign(new Error(
              "Cada línea necesita catalogItemId, o description y unitPriceCents explícitos",
            ), { statusCode: 400 });
          }
          const [item] = await tx
            .select()
            .from(catalogItems)
            .where(eq(catalogItems.id, line.catalogItemId));
          if (!item || !item.active || item.deletedAt) throw Object.assign(new Error("El producto seleccionado no está activo."), { statusCode: 400 });
          return {
            catalogItemId: item.id,
            description: line.description ?? item.name,
            unitPriceCents: line.unitPriceCents ?? item.unitPriceCents,
            quantity: line.quantity,
          };
        }),
      );

      const { subtotalCents, taxCents, totalCents } = quoteTotals(resolvedLines, body.taxRatePercent);

      const number = await nextCorrelativo(tx, "quote");

      const [quote] = await tx
        .insert(quotes)
        .values({
          number,
          customerSnapshot: { name: customer.name, nit: customer.nit, nrc: customer.nrc, address: customer.address, email: customer.email, phone: customer.phone },
          businessSnapshot: profile ?? { name: "Mi empresa" },
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
      const [before] = await tx.select().from(quotes).where(and(eq(quotes.id, id), isNull(quotes.deletedAt))).for("update");
      if (!before) return null;
      if (before.status === body.status) return { ...before, aviso: null };

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

      const esCorreccion = !CURSO_NATURAL[before.status]?.includes(after.status);
      return {
        ...after,
        aviso: esCorreccion
          ? `Se corrigió el estado: de «${ESTADO_ES[before.status]}» a «${ESTADO_ES[after.status]}». Queda registrado en la bitácora.`
          : null,
      };
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

      // Se archiva en cualquier estado, no solo en borrador. Una cotización
      // emitida al cliente equivocado tiene que poder salir de la lista, y el
      // archivado es lógico (deleted_at): el documento, sus renglones y su
      // rastro siguen existiendo en la base. No se pierde nada; deja de
      // estorbar.
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
