/**
 * La parte de plata del expediente de un cliente.
 *
 * Son dos cosas que la gente hoy lleva en un cuaderno o en la cabeza: el
 * precio que se le respeta a cada quien, y lo que va pasando con sus pagos.
 * Ninguna de las dos es el saldo — el saldo se calcula a partir de cargos y
 * abonos, y eso todavía no existe. Estas son las que se escriben a mano.
 *
 * La regla de todo el archivo: no se exige nada que la persona pueda no saber
 * en el momento de escribir. Un precio necesita un monto y algo que lo nombre;
 * una nota necesita texto. Todo lo demás puede quedar en blanco y llenarse
 * después.
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { catalogItems, customerMoneyNotes, customerPrices, customers } from "../db/schema.js";
import { logActivity } from "../lib/activity-log.js";
import { getUserId } from "../lib/request-context.js";

/** Un precio de más de veinte millones de dólares por unidad es un dedazo. */
const TOPE_PRECIO = 2_000_000_000;

const precioCrear = z.object({
  customerId: z.string().uuid(),
  catalogItemId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1).max(300).optional(),
  unitPriceCents: z.number().int().nonnegative().max(TOPE_PRECIO),
  unit: z.string().trim().max(40).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const precioCorregir = z.object({
  catalogItemId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1).max(300).optional(),
  unitPriceCents: z.number().int().nonnegative().max(TOPE_PRECIO).optional(),
  unit: z.string().trim().max(40).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const notaCrear = z.object({
  customerId: z.string().uuid(),
  notedOn: z.coerce.date().optional(),
  body: z.string().trim().min(1).max(4000),
});

const notaCorregir = z.object({
  notedOn: z.coerce.date().optional(),
  body: z.string().trim().min(1).max(4000).optional(),
});

async function exigirCliente(customerId: string) {
  const [cliente] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), isNull(customers.deletedAt)));
  if (!cliente) throw Object.assign(new Error("Ese cliente no existe."), { statusCode: 400 });
  return cliente;
}

export async function customerFinanceRoutes(app: FastifyInstance) {
  // --- Precios propios ----------------------------------------------------

  app.get("/customer-prices", async (req) => {
    const { customerId } = req.query as { customerId?: string };
    const condiciones = [
      isNull(customerPrices.deletedAt),
      ...(customerId ? [eq(customerPrices.customerId, customerId)] : []),
    ];
    return db.select().from(customerPrices).where(and(...condiciones)).orderBy(desc(customerPrices.createdAt));
  });

  app.post("/customer-prices", async (req, reply) => {
    const body = precioCrear.parse(req.body);
    await exigirCliente(body.customerId);

    // Si apunta a un producto y no le escribieron nombre, se toma el del
    // catálogo. Si no apunta a ninguno, el nombre es obligatorio: un precio
    // sin nada que lo identifique no le sirve a nadie.
    let description = body.description;
    if (!description) {
      if (!body.catalogItemId) {
        throw Object.assign(new Error("Escribí a qué producto o servicio corresponde este precio."), { statusCode: 400 });
      }
      const [item] = await db.select().from(catalogItems).where(eq(catalogItems.id, body.catalogItemId));
      if (!item) throw Object.assign(new Error("Ese producto no existe."), { statusCode: 400 });
      description = item.name;
    }

    const creado = await db.transaction(async (tx) => {
      const [fila] = await tx
        .insert(customerPrices)
        .values({ ...body, description, createdBy: getUserId(req) })
        .returning();
      if (!fila) throw new Error("No se pudo guardar el precio");
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "customer_prices",
        entityId: fila.id,
        action: "create",
        newValues: fila,
      });
      return fila;
    });

    return reply.code(201).send(creado);
  });

  app.patch("/customer-prices/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = precioCorregir.parse(req.body);

    const actualizado = await db.transaction(async (tx) => {
      const [antes] = await tx
        .select()
        .from(customerPrices)
        .where(and(eq(customerPrices.id, id), isNull(customerPrices.deletedAt)));
      if (!antes) return null;
      const [despues] = await tx
        .update(customerPrices)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(customerPrices.id, id))
        .returning();
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "customer_prices",
        entityId: id,
        action: "update",
        oldValues: antes,
        newValues: despues,
      });
      return despues;
    });

    if (!actualizado) return reply.code(404).send({ error: "No encontrado" });
    return actualizado;
  });

  app.delete("/customer-prices/:id", async (req, reply) => {
    const { id } = req.params as { id: string };

    const dado = await db.transaction(async (tx) => {
      const [antes] = await tx
        .select()
        .from(customerPrices)
        .where(and(eq(customerPrices.id, id), isNull(customerPrices.deletedAt)));
      if (!antes) return null;
      const [despues] = await tx
        .update(customerPrices)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(customerPrices.id, id))
        .returning();
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "customer_prices",
        entityId: id,
        action: "delete",
        oldValues: antes,
      });
      return despues;
    });

    if (!dado) return reply.code(404).send({ error: "No encontrado" });
    return reply.code(204).send();
  });

  // --- Notas de plata -----------------------------------------------------

  app.get("/customer-notes", async (req) => {
    const { customerId } = req.query as { customerId?: string };
    const condiciones = [
      isNull(customerMoneyNotes.deletedAt),
      ...(customerId ? [eq(customerMoneyNotes.customerId, customerId)] : []),
    ];
    // La más reciente arriba: una libreta se lee por el final.
    return db
      .select()
      .from(customerMoneyNotes)
      .where(and(...condiciones))
      .orderBy(desc(customerMoneyNotes.notedOn));
  });

  app.post("/customer-notes", async (req, reply) => {
    const body = notaCrear.parse(req.body);
    await exigirCliente(body.customerId);

    const creada = await db.transaction(async (tx) => {
      const [fila] = await tx
        .insert(customerMoneyNotes)
        .values({ ...body, createdBy: getUserId(req) })
        .returning();
      if (!fila) throw new Error("No se pudo guardar la nota");
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "customer_money_notes",
        entityId: fila.id,
        action: "create",
        newValues: fila,
      });
      return fila;
    });

    return reply.code(201).send(creada);
  });

  app.patch("/customer-notes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = notaCorregir.parse(req.body);

    const actualizada = await db.transaction(async (tx) => {
      const [antes] = await tx
        .select()
        .from(customerMoneyNotes)
        .where(and(eq(customerMoneyNotes.id, id), isNull(customerMoneyNotes.deletedAt)));
      if (!antes) return null;
      const [despues] = await tx
        .update(customerMoneyNotes)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(customerMoneyNotes.id, id))
        .returning();
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "customer_money_notes",
        entityId: id,
        action: "update",
        oldValues: antes,
        newValues: despues,
      });
      return despues;
    });

    if (!actualizada) return reply.code(404).send({ error: "No encontrado" });
    return actualizada;
  });

  app.delete("/customer-notes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };

    const dada = await db.transaction(async (tx) => {
      const [antes] = await tx
        .select()
        .from(customerMoneyNotes)
        .where(and(eq(customerMoneyNotes.id, id), isNull(customerMoneyNotes.deletedAt)));
      if (!antes) return null;
      const [despues] = await tx
        .update(customerMoneyNotes)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(customerMoneyNotes.id, id))
        .returning();
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "customer_money_notes",
        entityId: id,
        action: "delete",
        oldValues: antes,
      });
      return despues;
    });

    if (!dada) return reply.code(404).send({ error: "No encontrado" });
    return reply.code(204).send();
  });
}
