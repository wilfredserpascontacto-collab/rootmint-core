import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  businessProfile,
  catalogItems,
  customers,
  invoiceLines,
  invoices,
  quoteLines,
  quotes,
} from "../db/schema.js";
import { quoteTotals } from "../lib/quote-math.js";
import { logActivity } from "../lib/activity-log.js";
import { nextCorrelativo } from "../lib/counters.js";
import { getUserId } from "../lib/request-context.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Cada serie lleva su propio contador: hay una factura 1 de cada tipo. */
const CONTADOR = { ccf: "invoice:ccf", final: "invoice:final" } as const;

const NOMBRE_TIPO = {
  ccf: "comprobante de crédito fiscal",
  final: "factura de consumidor final",
} as const;

const lineaSchema = z.object({
  catalogItemId: z.string().uuid().optional(),
  quoteLineId: z.string().uuid().optional(),
  description: z.string().min(1).optional(),
  unitPriceCents: z.number().int().nonnegative().optional(),
  quantity: z.number().int().positive("La cantidad tiene que ser mayor que cero."),
});

const crearSchema = z.object({
  kind: z.enum(["ccf", "final"]).optional(),
  customerId: z.string().uuid().optional(),
  quoteId: z.string().uuid().optional(),
  issueDate: z.string().datetime().optional(),
  taxRatePercent: z.number().min(0).max(100).optional(),
  notes: z.string().optional(),
  lines: z.array(lineaSchema).optional(),
});

const anularSchema = z.object({
  reason: z.string().min(3, "Decí por qué se anula: dentro de seis meses nadie va a recordarlo."),
});

const dinero = (c: number) => `$${(c / 100).toFixed(2)}`;

/**
 * Que tipo de documento le toca a este cliente.
 *
 * La regla en El Salvador es simple: si presenta NRC, credito fiscal; si no,
 * consumidor final. El sistema PROPONE, no decide — quien factura puede tener
 * enfrente a alguien que trajo el NRC en un papel y todavia no esta cargado.
 */
function tipoSugerido(cliente: { nrc: string | null }): "ccf" | "final" {
  return cliente.nrc && cliente.nrc.trim() !== "" ? "ccf" : "final";
}

/**
 * Resuelve las lineas: descripcion y precio salen del catalogo si no vienen
 * dados, y quedan congelados en la factura. Una factura emitida tiene que
 * decir lo mismo dentro de dos anos, pase lo que pase con el catalogo.
 */
async function resolverLineas(
  tx: Tx,
  lineas: z.infer<typeof lineaSchema>[],
): Promise<{ renglones: (typeof invoiceLines.$inferInsert)[]; avisos: string[] }> {
  const avisos: string[] = [];
  const ids = lineas.map((l) => l.catalogItemId).filter((x): x is string => Boolean(x));
  const items = ids.length
    ? await tx.select().from(catalogItems).where(inArray(catalogItems.id, ids))
    : [];
  const porId = new Map(items.map((i) => [i.id, i]));

  const renglones = lineas.map((l, i) => {
    const item = l.catalogItemId ? porId.get(l.catalogItemId) : undefined;
    if (l.catalogItemId && !item) {
      throw Object.assign(new Error("Uno de los productos ya no existe en el catálogo."), {
        statusCode: 400,
      });
    }
    const description = l.description ?? item?.name;
    const unitPriceCents = l.unitPriceCents ?? item?.unitPriceCents;
    if (!description || unitPriceCents === undefined) {
      throw Object.assign(
        new Error("Cada línea necesita una descripción y un precio, o un producto del catálogo."),
        { statusCode: 400 },
      );
    }
    return {
      invoiceId: "",
      catalogItemId: l.catalogItemId ?? null,
      quoteLineId: l.quoteLineId ?? null,
      description,
      quantity: l.quantity,
      unitPriceCents,
      subtotalCents: l.quantity * unitPriceCents,
      displayOrder: i,
    };
  });

  return { renglones, avisos };
}

/**
 * Cuanto queda por facturar de cada renglon de una cotizacion.
 *
 * Cuenta solo las facturas vivas: una anulada no consumio nada. Sin esto, un
 * error corregido al dia siguiente dejaria la cotizacion como facturada para
 * siempre.
 */
async function pendientePorFacturar(tx: Tx, quoteId: string) {
  const renglones = await tx
    .select()
    .from(quoteLines)
    .where(and(eq(quoteLines.quoteId, quoteId), isNull(quoteLines.deletedAt)));

  const facturado = await tx
    .select({
      quoteLineId: invoiceLines.quoteLineId,
      cantidad: sql<number>`sum(${invoiceLines.quantity})::int`,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(and(eq(invoices.quoteId, quoteId), eq(invoices.status, "issued")))
    .groupBy(invoiceLines.quoteLineId);

  const yaFacturado = new Map(facturado.map((f) => [f.quoteLineId, Number(f.cantidad) || 0]));

  return renglones.map((r) => ({
    quoteLineId: r.id,
    description: r.description,
    unitPriceCents: r.unitPriceCents,
    cotizado: r.quantity,
    facturado: yaFacturado.get(r.id) ?? 0,
    pendiente: r.quantity - (yaFacturado.get(r.id) ?? 0),
  }));
}

export async function invoicesRoutes(app: FastifyInstance) {
  app.get("/invoices", async (req) => {
    const { customerId, quoteId } = req.query as { customerId?: string; quoteId?: string };
    const filtros = [isNull(invoices.deletedAt)];
    if (customerId) filtros.push(eq(invoices.customerId, customerId));
    if (quoteId) filtros.push(eq(invoices.quoteId, quoteId));

    return db
      .select()
      .from(invoices)
      .where(and(...filtros))
      .orderBy(desc(invoices.issueDate), desc(invoices.number));
  });

  app.get("/invoices/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [factura] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!factura) return reply.code(404).send({ error: "Esa factura no existe." });
    const lineas = await db
      .select()
      .from(invoiceLines)
      .where(and(eq(invoiceLines.invoiceId, id), isNull(invoiceLines.deletedAt)))
      .orderBy(invoiceLines.displayOrder);
    return { ...factura, lines: lineas };
  });

  /** Que falta facturar de una cotizacion, renglon por renglon. */
  app.get("/quotes/:id/por-facturar", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [cot] = await db.select().from(quotes).where(eq(quotes.id, id));
    if (!cot) return reply.code(404).send({ error: "Esa cotización no existe." });
    return { quoteId: id, lines: await pendientePorFacturar(db as unknown as Tx, id) };
  });

  app.post("/invoices", async (req, reply) => {
    const body = crearSchema.parse(req.body);

    if (!body.quoteId && !body.customerId) {
      return reply.code(400).send({
        error: "Una factura necesita un cliente, o una cotización de la que salir.",
      });
    }

    const resultado = await db.transaction(async (tx) => {
      const avisos: string[] = [];

      // --- De donde sale ---------------------------------------------------
      let cotizacion: typeof quotes.$inferSelect | undefined;
      if (body.quoteId) {
        [cotizacion] = await tx.select().from(quotes).where(eq(quotes.id, body.quoteId));
        if (!cotizacion) {
          throw Object.assign(new Error("Esa cotización no existe."), { statusCode: 404 });
        }
        if (cotizacion.status === "rejected") {
          avisos.push("Esta cotización está marcada como rechazada y la estás facturando igual.");
        }
      }

      const customerId = body.customerId ?? cotizacion?.customerId;
      if (!customerId) {
        throw Object.assign(new Error("Falta el cliente."), { statusCode: 400 });
      }
      const [cliente] = await tx.select().from(customers).where(eq(customers.id, customerId));
      if (!cliente) {
        throw Object.assign(new Error("Ese cliente no existe."), { statusCode: 400 });
      }

      // --- Que tipo de documento ------------------------------------------
      const sugerido = tipoSugerido(cliente);
      const kind = body.kind ?? sugerido;
      if (kind === "ccf" && sugerido === "final") {
        avisos.push(
          `«${cliente.name}» no tiene NRC cargado. Un crédito fiscal sin NRC no le sirve a Hacienda: cargale el NRC o emití una factura de consumidor final.`,
        );
      }
      if (kind === "final" && sugerido === "ccf") {
        avisos.push(
          `«${cliente.name}» tiene NRC, así que probablemente quiera un crédito fiscal para descontarse el IVA. Esta va como consumidor final.`,
        );
      }

      // --- Las lineas ------------------------------------------------------
      let entrada = body.lines;
      if (!entrada || entrada.length === 0) {
        if (!cotizacion) {
          throw Object.assign(new Error("Una factura suelta necesita al menos una línea."), {
            statusCode: 400,
          });
        }
        // Sin lineas explicitas se factura lo que falte de la cotizacion.
        const pendiente = await pendientePorFacturar(tx, cotizacion.id);
        const conSaldo = pendiente.filter((p) => p.pendiente > 0);
        if (conSaldo.length === 0) {
          throw Object.assign(
            new Error("Esta cotización ya está facturada por completo."),
            { statusCode: 409 },
          );
        }
        entrada = conSaldo.map((p) => ({
          quoteLineId: p.quoteLineId,
          description: p.description,
          unitPriceCents: p.unitPriceCents,
          quantity: p.pendiente,
        }));
      }

      const { renglones } = await resolverLineas(tx, entrada);

      // --- Avisar si se pasa de lo cotizado --------------------------------
      // Avisar, no impedir: a veces se entrega mas de lo que decia el papel, y
      // el sistema no es quien para decidir que eso no paso.
      if (cotizacion) {
        const pendiente = await pendientePorFacturar(tx, cotizacion.id);
        const porRenglon = new Map(pendiente.map((p) => [p.quoteLineId, p]));
        for (const r of renglones) {
          if (!r.quoteLineId) continue;
          const p = porRenglon.get(r.quoteLineId);
          if (p && r.quantity > p.pendiente) {
            avisos.push(
              `De «${p.description}» quedaban ${p.pendiente} por facturar y estás facturando ${r.quantity}.`,
            );
          }
        }
      }

      // --- Totales ---------------------------------------------------------
      const tasa =
        body.taxRatePercent !== undefined
          ? body.taxRatePercent
          : cotizacion
            ? cotizacion.taxRateMilli / 1000
            : 13;
      const totales = quoteTotals(renglones, tasa);

      // --- El numero, dentro de su serie -----------------------------------
      const number = await nextCorrelativo(tx, CONTADOR[kind]);

      const [perfil] = await tx.select().from(businessProfile).limit(1);

      const [factura] = await tx
        .insert(invoices)
        .values({
          kind,
          number,
          customerId,
          quoteId: cotizacion?.id ?? null,
          issueDate: body.issueDate ? new Date(body.issueDate) : new Date(),
          taxRateMilli: Math.round(tasa * 1000),
          notes: body.notes ?? null,
          createdBy: getUserId(req),
          // Congelados: la factura tiene que poder reimprimirse identica dentro
          // de dos anos aunque el cliente se mude o la empresa cambie de NIT.
          customerSnapshot: cliente,
          businessSnapshot: perfil ?? null,
          ...totales,
        })
        .returning();

      if (!factura) throw new Error("No se pudo crear la factura.");

      await tx
        .insert(invoiceLines)
        .values(renglones.map((r) => ({ ...r, invoiceId: factura.id })));

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "invoices",
        entityId: factura.id,
        action: "create",
        newValues: { kind, number, totalCents: factura.totalCents, quoteId: factura.quoteId },
      });

      return { factura, avisos };
    });

    return reply.code(201).send({ ...resultado.factura, avisos: resultado.avisos });
  });

  /**
   * Anular. No hay forma de editar una factura emitida, a proposito.
   *
   * El numero no se reusa: queda anulado, con su motivo, y la serie sigue. Un
   * hueco explicado no le molesta a nadie; uno sin explicar es justo lo que
   * pregunta un auditor.
   */
  app.post("/invoices/:id/anular", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = anularSchema.parse(req.body);

    const anulada = await db.transaction(async (tx) => {
      const [antes] = await tx.select().from(invoices).where(eq(invoices.id, id));
      if (!antes) return null;
      if (antes.status === "annulled") {
        throw Object.assign(new Error("Esa factura ya estaba anulada."), { statusCode: 409 });
      }

      const [despues] = await tx
        .update(invoices)
        .set({
          status: "annulled",
          annulledAt: new Date(),
          annulReason: body.reason.trim(),
          annulledBy: getUserId(req),
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, id))
        .returning();

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "invoices",
        entityId: id,
        action: "update",
        oldValues: { status: antes.status },
        newValues: { status: "annulled", reason: body.reason.trim() },
      });

      return despues;
    });

    if (!anulada) return reply.code(404).send({ error: "Esa factura no existe." });
    return {
      ...anulada,
      avisos: [
        `Quedó anulada la ${NOMBRE_TIPO[anulada.kind]} número ${anulada.number}. El número no se reusa: la próxima sigue la serie.`,
      ],
    };
  });
}
