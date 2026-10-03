import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  catalogItems,
  customers,
  invoices,
  quoteLines,
  quotes,
  salesOrderLines,
  salesOrders,
} from "../db/schema.js";
import { blockTypes, productionOrders } from "../db/schema-bloques.js";
import { logActivity } from "../lib/activity-log.js";
import { nextCorrelativo } from "../lib/counters.js";
import { getUserId } from "../lib/request-context.js";
import { facturadoPorRenglon, reservaVigente, reservadoPorTipo } from "../lib/reservas.js";
import { existencias } from "./inventario.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const MAX = 1_000_000;

const textoOpcional = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v ? v : null));

const crearSchema = z.object({
  customerId: z.string().uuid("Elegí el cliente."),
  neededBy: z.coerce.date().optional(),
  deliveryAddress: textoOpcional,
  notes: textoOpcional,
  lines: z
    .array(
      z.object({
        catalogItemId: z.string().uuid().optional(),
        description: z.string().trim().min(1).max(300).optional(),
        unitPriceCents: z.number().int().nonnegative().max(MAX * 100).optional(),
        quantity: z.number().int().positive("La cantidad tiene que ser mayor que cero.").max(MAX),
      }),
    )
    .min(1, "Un pedido necesita al menos un renglón.")
    .max(60),
});

const desdeCotizacionSchema = z.object({
  quoteId: z.string().uuid(),
  neededBy: z.coerce.date().optional(),
  deliveryAddress: textoOpcional,
  notes: textoOpcional,
});

const editarSchema = z.object({
  neededBy: z.coerce.date().nullable().optional(),
  deliveryAddress: textoOpcional,
  notes: textoOpcional,
});

const motivoSchema = z.object({
  reason: z.string().trim().min(3, "Decí por qué se cancela: dentro de seis meses nadie va a recordarlo."),
});

const liberarSchema = z.object({ lineId: z.string().uuid().optional() });

function err(mensaje: string, statusCode: number) {
  return Object.assign(new Error(mensaje), { statusCode });
}

/**
 * Aparta del patio lo que se pueda, renglon por renglon y en orden.
 *
 * Aparta lo LIBRE: la existencia menos lo que ya esta apartado para otros
 * pedidos. Nunca promete mas de lo que hay, porque una reserva es una promesa a
 * un cliente; para eso esta el aviso de lo que falta producir.
 */
async function apartar(tx: Tx, orderId: string, soloRenglon?: string): Promise<string[]> {
  // Dos vendedores apartando a la vez no pueden llevarse los mismos bloques.
  await tx.execute(sql`select pg_advisory_xact_lock(7001)`);

  const renglones = await tx
    .select({
      id: salesOrderLines.id,
      quoteLineId: salesOrderLines.quoteLineId,
      description: salesOrderLines.description,
      quantity: salesOrderLines.quantity,
      apartado: salesOrderLines.reservedQuantity,
      blockTypeId: catalogItems.blockTypeId,
    })
    .from(salesOrderLines)
    .leftJoin(catalogItems, eq(catalogItems.id, salesOrderLines.catalogItemId))
    .where(and(eq(salesOrderLines.orderId, orderId), isNull(salesOrderLines.deletedAt)))
    .orderBy(asc(salesOrderLines.displayOrder));

  const facturado = await facturadoPorRenglon(tx, renglones);
  const stock = await existencias(tx);
  const reservado = await reservadoPorTipo(tx);
  const libre = new Map<string, number>();
  const libreDe = (tipo: string) => {
    if (!libre.has(tipo)) libre.set(tipo, (stock.get(tipo) ?? 0) - (reservado.get(tipo)?.cantidad ?? 0));
    return libre.get(tipo) ?? 0;
  };

  const avisos: string[] = [];
  for (const r of renglones) {
    if (!r.blockTypeId || (soloRenglon && r.id !== soloRenglon)) continue;
    const ya = facturado.get(r.id) ?? 0;
    const pendiente = Math.max(0, r.quantity - ya);
    const vigente = reservaVigente(r.apartado, ya);
    const falta = pendiente - vigente;
    if (falta <= 0) continue;

    const disponible = Math.max(0, libreDe(r.blockTypeId));
    const doy = Math.min(falta, disponible);
    if (doy > 0) {
      await tx
        .update(salesOrderLines)
        .set({ reservedQuantity: ya + vigente + doy, updatedAt: new Date() })
        .where(eq(salesOrderLines.id, r.id));
      libre.set(r.blockTypeId, libreDe(r.blockTypeId) - doy);
    }
    if (doy < falta) {
      avisos.push(
        doy === 0
          ? `De «${r.description}» no hay bloques libres en el patio: faltan ${falta} por producir.`
          : `De «${r.description}» se apartaron ${doy} de los ${falta} que faltan; los otros ${falta - doy} hay que producirlos.`,
      );
    }
  }
  return avisos;
}

/** El pedido con su avance, renglon por renglon. Una sola forma para todas las pantallas. */
async function fichaDelPedido(id: string) {
  const [pedido] = await db
    .select()
    .from(salesOrders)
    .where(and(eq(salesOrders.id, id), isNull(salesOrders.deletedAt)));
  if (!pedido) return null;

  const filas = await db
    .select({
      id: salesOrderLines.id,
      catalogItemId: salesOrderLines.catalogItemId,
      quoteLineId: salesOrderLines.quoteLineId,
      description: salesOrderLines.description,
      quantity: salesOrderLines.quantity,
      unitPriceCents: salesOrderLines.unitPriceCents,
      apartado: salesOrderLines.reservedQuantity,
      blockTypeId: catalogItems.blockTypeId,
      blockTypeName: blockTypes.name,
    })
    .from(salesOrderLines)
    .leftJoin(catalogItems, eq(catalogItems.id, salesOrderLines.catalogItemId))
    .leftJoin(blockTypes, eq(blockTypes.id, catalogItems.blockTypeId))
    .where(and(eq(salesOrderLines.orderId, id), isNull(salesOrderLines.deletedAt)))
    .orderBy(asc(salesOrderLines.displayOrder));

  const facturado = await facturadoPorRenglon(db, filas);
  const stock = await existencias(db);
  const abierto = pedido.status === "abierto";

  const lines = filas.map((r) => {
    const ya = facturado.get(r.id) ?? 0;
    const pendiente = Math.max(0, r.quantity - ya);
    const reservado = abierto ? Math.min(pendiente, reservaVigente(r.apartado, ya)) : 0;
    const producible = Boolean(r.blockTypeId);
    return {
      id: r.id,
      catalogItemId: r.catalogItemId,
      description: r.description,
      quantity: r.quantity,
      unitPriceCents: r.unitPriceCents,
      subtotalCents: r.quantity * r.unitPriceCents,
      facturado: ya,
      pendiente,
      esProducible: producible,
      blockTypeId: r.blockTypeId,
      blockTypeName: r.blockTypeName,
      reservado,
      // Lo que falta producir para poder cumplir lo pendiente. Nunca negativo.
      porProducir: producible ? Math.max(0, pendiente - reservado) : 0,
      enPatio: producible ? (stock.get(r.blockTypeId as string) ?? 0) : null,
    };
  });

  const cumplido = lines.length > 0 && lines.every((l) => l.pendiente === 0);
  const facturas = await db
    .select({
      id: invoices.id,
      kind: invoices.kind,
      number: invoices.number,
      status: invoices.status,
      totalCents: invoices.totalCents,
      issueDate: invoices.issueDate,
    })
    .from(invoices)
    .where(
      pedido.quoteId
        ? or(eq(invoices.salesOrderId, id), eq(invoices.quoteId, pedido.quoteId))
        : eq(invoices.salesOrderId, id),
    )
    .orderBy(desc(invoices.issueDate));

  const ordenes = pedido.quoteId
    ? await db
        .select({ id: productionOrders.id, number: productionOrders.number, status: productionOrders.status })
        .from(productionOrders)
        .where(and(eq(productionOrders.quoteId, pedido.quoteId), isNull(productionOrders.deletedAt)))
    : [];

  return {
    ...pedido,
    estado: pedido.status === "cancelado" ? "cancelado" : cumplido ? "cumplido" : "abierto",
    lines,
    totalCents: lines.reduce((a, l) => a + l.subtotalCents, 0),
    pedido: lines.reduce((a, l) => a + l.quantity, 0),
    facturado: lines.reduce((a, l) => a + Math.min(l.facturado, l.quantity), 0),
    reservado: lines.reduce((a, l) => a + l.reservado, 0),
    porProducir: lines.reduce((a, l) => a + l.porProducir, 0),
    invoices: facturas,
    productionOrders: ordenes,
  };
}

export async function pedidosRoutes(app: FastifyInstance) {
  app.get("/pedidos", async (req) => {
    const { estado } = req.query as { estado?: string };
    const pedidos = await db
      .select()
      .from(salesOrders)
      .where(isNull(salesOrders.deletedAt))
      .orderBy(desc(salesOrders.number));
    const lineas = pedidos.length
      ? await db
          .select()
          .from(salesOrderLines)
          .where(
            and(
              inArray(salesOrderLines.orderId, pedidos.map((p) => p.id)),
              isNull(salesOrderLines.deletedAt),
            ),
          )
      : [];
    const facturado = await facturadoPorRenglon(db, lineas);

    const filas = pedidos.map((p) => {
      const propias = lineas.filter((l) => l.orderId === p.id);
      const pendientes = propias.map((l) => Math.max(0, l.quantity - (facturado.get(l.id) ?? 0)));
      const cumplido = propias.length > 0 && pendientes.every((x) => x === 0);
      return {
        id: p.id,
        number: p.number,
        customerName: p.customerName,
        status: p.status,
        estado: p.status === "cancelado" ? "cancelado" : cumplido ? "cumplido" : "abierto",
        neededBy: p.neededBy,
        createdAt: p.createdAt,
        quoteId: p.quoteId,
        renglones: propias.length,
        pedido: propias.reduce((a, l) => a + l.quantity, 0),
        pendiente: pendientes.reduce((a, x) => a + x, 0),
        totalCents: propias.reduce((a, l) => a + l.quantity * l.unitPriceCents, 0),
      };
    });
    return estado === "todos" ? filas : filas.filter((f) => f.estado === "abierto");
  });

  app.get("/pedidos/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const f = await fichaDelPedido(id);
    if (!f) return reply.code(404).send({ error: "Ese pedido no existe." });
    return f;
  });

  app.post("/pedidos", async (req, reply) => {
    const body = crearSchema.parse(req.body);

    const nuevo = await db.transaction(async (tx) => {
      const [cliente] = await tx.select().from(customers).where(eq(customers.id, body.customerId));
      if (!cliente) throw err("Ese cliente no existe.", 400);

      const ids = [...new Set(body.lines.map((l) => l.catalogItemId).filter((x): x is string => Boolean(x)))];
      const items = ids.length ? await tx.select().from(catalogItems).where(inArray(catalogItems.id, ids)) : [];
      const porId = new Map(items.map((i) => [i.id, i]));

      const renglones = body.lines.map((l, i) => {
        const item = l.catalogItemId ? porId.get(l.catalogItemId) : undefined;
        if (l.catalogItemId && !item) throw err("Uno de los productos ya no existe en el catálogo.", 400);
        const description = l.description ?? item?.name;
        const unitPriceCents = l.unitPriceCents ?? item?.unitPriceCents;
        if (!description || unitPriceCents === undefined) {
          throw err("Cada renglón necesita una descripción y un precio, o un producto del catálogo.", 400);
        }
        return {
          catalogItemId: l.catalogItemId ?? null,
          description,
          quantity: l.quantity,
          unitPriceCents,
          displayOrder: i,
        };
      });

      return crearPedido(tx, req, {
        customerId: cliente.id,
        customerName: cliente.name,
        quoteId: null,
        neededBy: body.neededBy ?? null,
        deliveryAddress: body.deliveryAddress,
        notes: body.notes,
        renglones,
      });
    });
    return reply.code(201).send(nuevo);
  });

  app.post("/pedidos/desde-cotizacion", async (req, reply) => {
    const body = desdeCotizacionSchema.parse(req.body);

    const nuevo = await db.transaction(async (tx) => {
      const [cot] = await tx.select().from(quotes).where(eq(quotes.id, body.quoteId));
      if (!cot) throw err("Esa cotización no existe.", 400);
      const [cliente] = await tx.select().from(customers).where(eq(customers.id, cot.customerId));
      if (!cliente) throw err("El cliente de esa cotización ya no existe.", 400);

      const [yaHay] = await tx
        .select({ id: salesOrders.id, number: salesOrders.number })
        .from(salesOrders)
        .where(
          and(eq(salesOrders.quoteId, cot.id), eq(salesOrders.status, "abierto"), isNull(salesOrders.deletedAt)),
        );
      if (yaHay) {
        throw Object.assign(
          new Error(`Esta cotización ya tiene el pedido N° ${yaHay.number} abierto. Trabajá ese en vez de crear otro.`),
          { statusCode: 409, pedidoId: yaHay.id },
        );
      }

      const lineas = await tx
        .select()
        .from(quoteLines)
        .where(and(eq(quoteLines.quoteId, cot.id), isNull(quoteLines.deletedAt)))
        .orderBy(asc(quoteLines.displayOrder));
      if (lineas.length === 0) throw err("Esa cotización no tiene renglones.", 400);

      const avisos: string[] = [];
      if (cot.status === "rejected") avisos.push("Esta cotización está marcada como rechazada y la estás convirtiendo en pedido igual.");
      if (cot.status === "draft") avisos.push("Esta cotización sigue en borrador: todavía no se le mandó al cliente.");

      return crearPedido(tx, req, {
        customerId: cliente.id,
        customerName: cliente.name,
        quoteId: cot.id,
        neededBy: body.neededBy ?? null,
        deliveryAddress: body.deliveryAddress,
        notes: body.notes,
        avisosPrevios: avisos,
        renglones: lineas.map((l, i) => ({
          catalogItemId: l.catalogItemId,
          quoteLineId: l.id,
          description: l.description,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          displayOrder: i,
        })),
      });
    });
    return reply.code(201).send(nuevo);
  });

  app.patch("/pedidos/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = editarSchema.parse(req.body);
    const [p] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, id), isNull(salesOrders.deletedAt)));
    if (!p) return reply.code(404).send({ error: "Ese pedido no existe." });
    if (p.status === "cancelado") return reply.code(409).send({ error: "Ese pedido está cancelado." });
    await db
      .update(salesOrders)
      .set({
        ...(body.neededBy !== undefined ? { neededBy: body.neededBy } : {}),
        ...(req.body && typeof req.body === "object" && "deliveryAddress" in req.body
          ? { deliveryAddress: body.deliveryAddress }
          : {}),
        ...(req.body && typeof req.body === "object" && "notes" in req.body ? { notes: body.notes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(salesOrders.id, id));
    return fichaDelPedido(id);
  });

  /** Volver a intentar apartar: sirve cuando llego produccion despues de crear el pedido. */
  app.post("/pedidos/:id/reservar", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [p] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, id), isNull(salesOrders.deletedAt)));
    if (!p) return reply.code(404).send({ error: "Ese pedido no existe." });
    if (p.status === "cancelado") return reply.code(409).send({ error: "Ese pedido está cancelado." });

    const avisos = await db.transaction(async (tx) => {
      const a = await apartar(tx, id);
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "sales_orders",
        entityId: id,
        action: "update",
        newValues: { reservar: true },
      });
      return a;
    });
    const f = await fichaDelPedido(id);
    if (f && f.reservado === f.lines.reduce((a, l) => a + (l.esProducible ? l.pendiente : 0), 0) && avisos.length === 0) {
      avisos.push("Todo lo pendiente de este pedido ya está apartado en el patio.");
    }
    return { ...f, avisos };
  });

  /** Soltar lo apartado (de un renglon o de todo el pedido) para que lo use otro. */
  app.post("/pedidos/:id/liberar", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = liberarSchema.parse(req.body ?? {});
    const [p] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, id), isNull(salesOrders.deletedAt)));
    if (!p) return reply.code(404).send({ error: "Ese pedido no existe." });
    if (p.status === "cancelado") return reply.code(409).send({ error: "Ese pedido está cancelado." });

    await db.transaction(async (tx) => {
      const filas = await tx
        .select()
        .from(salesOrderLines)
        .where(and(eq(salesOrderLines.orderId, id), isNull(salesOrderLines.deletedAt)));
      if (body.lineId && !filas.some((f) => f.id === body.lineId)) {
        throw err("Ese renglón no es de este pedido.", 400);
      }
      const facturado = await facturadoPorRenglon(tx, filas);
      for (const f of filas) {
        if (body.lineId && f.id !== body.lineId) continue;
        // Dejar el apartado en lo ya facturado: la reserva vigente queda en cero.
        await tx
          .update(salesOrderLines)
          .set({ reservedQuantity: facturado.get(f.id) ?? 0, updatedAt: new Date() })
          .where(eq(salesOrderLines.id, f.id));
      }
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "sales_orders",
        entityId: id,
        action: "update",
        newValues: { liberar: body.lineId ?? "todo" },
      });
    });
    const f = await fichaDelPedido(id);
    return { ...f, avisos: ["Quedó liberado: esos bloques vuelven a estar disponibles para otros pedidos."] };
  });

  app.post("/pedidos/:id/cancelar", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = motivoSchema.parse(req.body);
    const [p] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, id), isNull(salesOrders.deletedAt)));
    if (!p) return reply.code(404).send({ error: "Ese pedido no existe." });
    if (p.status === "cancelado") return reply.code(409).send({ error: "Ese pedido ya estaba cancelado." });

    await db.transaction(async (tx) => {
      await tx
        .update(salesOrders)
        .set({
          status: "cancelado",
          cancelledAt: new Date(),
          cancelReason: body.reason,
          cancelledBy: getUserId(req),
          updatedAt: new Date(),
        })
        .where(eq(salesOrders.id, id));
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "sales_orders",
        entityId: id,
        action: "update",
        oldValues: { status: "abierto" },
        newValues: { status: "cancelado", reason: body.reason },
      });
    });
    const f = await fichaDelPedido(id);
    return {
      ...f,
      avisos: [
        `Quedó cancelado el pedido N° ${p.number}. Lo que tenía apartado en el patio vuelve a estar disponible. Las facturas ya emitidas no se tocan.`,
      ],
    };
  });
}

async function crearPedido(
  tx: Tx,
  req: Parameters<typeof getUserId>[0],
  d: {
    customerId: string;
    customerName: string;
    quoteId: string | null;
    neededBy: Date | null;
    deliveryAddress: string | null;
    notes: string | null;
    avisosPrevios?: string[];
    renglones: {
      catalogItemId: string | null;
      quoteLineId?: string | null;
      description: string;
      quantity: number;
      unitPriceCents: number;
      displayOrder: number;
    }[];
  },
) {
  const number = await nextCorrelativo(tx, "sales_order");
  const [pedido] = await tx
    .insert(salesOrders)
    .values({
      number,
      customerId: d.customerId,
      customerName: d.customerName,
      quoteId: d.quoteId,
      neededBy: d.neededBy,
      deliveryAddress: d.deliveryAddress,
      notes: d.notes,
      createdBy: getUserId(req),
    })
    .returning();
  if (!pedido) throw new Error("No se pudo crear el pedido.");

  await tx
    .insert(salesOrderLines)
    .values(d.renglones.map((r) => ({ ...r, quoteLineId: r.quoteLineId ?? null, orderId: pedido.id })));

  const avisos = [...(d.avisosPrevios ?? []), ...(await apartar(tx, pedido.id))];

  await logActivity(tx, {
    userId: getUserId(req),
    entity: "sales_orders",
    entityId: pedido.id,
    action: "create",
    newValues: { number, customerId: d.customerId, quoteId: d.quoteId },
  });
  return { id: pedido.id, number, avisos };
}
