/**
 * Ordenes de produccion: lo que la cotizacion le manda a decir a la planta.
 *
 * Es el eslabon que pidieron en la reunion —«la cotizacion debe poder pasarse
 * a produccion como una orden, para que el maquinista proceda a crear los
 * ladrillos»— y el unico que faltaba para que el circulo diera la vuelta
 * entera:
 *
 *   cotizar → ORDEN → producir → inventario → facturar
 *
 * Lo que se decide aca y no en la pantalla:
 *
 *  - **La orden pide lo que falta, no lo que se vendio.** Si hay 540 en el
 *    patio y el cliente pidio 1.000, la orden dice 460.
 *  - **El avance se calcula, nunca se escribe.** Lo producido es la suma de
 *    los lotes que apuntan a la orden. No hay una columna «avance» que se
 *    pueda desincronizar.
 *  - **Una cotizacion no puede tener dos ordenes vivas.** Es la unica forma
 *    conocida de fabricar el doble sin que nadie se entere.
 *  - **Avisar no es impedir.** Producir de mas, cerrar de menos y pedir lo
 *    que ya esta en el patio se avisan, y se dejan pasar.
 */

import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { catalogItems, quoteLines, quotes } from "../db/schema.js";
import {
  batches,
  blockTypes,
  productionOrderLines,
  productionOrders,
  recipes,
} from "../db/schema-bloques.js";
import { logActivity } from "../lib/activity-log.js";
import { getUserId } from "../lib/request-context.js";
import { nextCorrelativo } from "../lib/counters.js";
import { existencias } from "./inventario.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Una orden «viva» es la que todavia espera bloques. */
const VIVAS = ["pendiente", "en_proceso"] as const;

const MAX_BLOQUES = 1_000_000;

const desdeCotizacionSchema = z.object({
  quoteId: z.string().uuid(),
  neededBy: z.coerce.date().optional(),
  notes: z.string().max(2000).optional(),
});

const sueltaSchema = z.object({
  customerName: z.string().max(200).optional(),
  neededBy: z.coerce.date().optional(),
  notes: z.string().max(2000).optional(),
  lines: z
    .array(
      z.object({
        blockTypeId: z.string().uuid(),
        quantity: z.number().int().positive().max(MAX_BLOQUES),
      }),
    )
    .min(1)
    .max(40),
});

/**
 * Cuanto se produjo contra cada orden, por tipo de bloque.
 *
 * Solo cuentan los bloques BUENOS: los rotos se contaron al producir y nunca
 * fueron entregables. Un maquinista que rompe 200 no cumplio una orden de 600
 * porque salieron 800 del molde.
 */
async function producidoPorOrden(tx: Tx | typeof db, orderIds: string[]) {
  if (orderIds.length === 0) return new Map<string, number>();
  const filas = await tx
    .select({
      orderId: batches.productionOrderId,
      blockTypeId: batches.blockTypeId,
      buenos: sql<number>`sum(${batches.blocksGood})::int`,
    })
    .from(batches)
    .where(and(inArray(batches.productionOrderId, orderIds), isNull(batches.deletedAt)))
    .groupBy(batches.productionOrderId, batches.blockTypeId);
  return new Map(filas.map((f) => [`${f.orderId}:${f.blockTypeId}`, Number(f.buenos) || 0]));
}

/** Cuantos bloques de cada tipo estan prometidos por ordenes todavia vivas. */
async function comprometido(tx: Tx | typeof db, exceptoOrden?: string) {
  const filas = await tx
    .select({
      blockTypeId: productionOrderLines.blockTypeId,
      orderId: productionOrderLines.orderId,
      pedido: productionOrderLines.quantity,
    })
    .from(productionOrderLines)
    .innerJoin(productionOrders, eq(productionOrderLines.orderId, productionOrders.id))
    .where(
      and(
        inArray(productionOrders.status, [...VIVAS]),
        isNull(productionOrders.deletedAt),
        exceptoOrden ? ne(productionOrders.id, exceptoOrden) : undefined,
      ),
    );
  const producido = await producidoPorOrden(
    tx,
    [...new Set(filas.map((f) => f.orderId))],
  );
  const mapa = new Map<string, number>();
  for (const f of filas) {
    const hecho = producido.get(`${f.orderId}:${f.blockTypeId}`) ?? 0;
    const falta = Math.max(0, f.pedido - hecho);
    mapa.set(f.blockTypeId, (mapa.get(f.blockTypeId) ?? 0) + falta);
  }
  return mapa;
}

/** La orden con sus renglones, su avance y sus lotes. Una sola forma para todos. */
async function fichaDeLaOrden(id: string) {
  const [orden] = await db.select().from(productionOrders).where(eq(productionOrders.id, id));
  if (!orden) return null;

  const renglones = await db
    .select({
      id: productionOrderLines.id,
      blockTypeId: productionOrderLines.blockTypeId,
      description: productionOrderLines.description,
      quantity: productionOrderLines.quantity,
      quoteLineId: productionOrderLines.quoteLineId,
      code: blockTypes.code,
    })
    .from(productionOrderLines)
    .leftJoin(blockTypes, eq(productionOrderLines.blockTypeId, blockTypes.id))
    .where(eq(productionOrderLines.orderId, id));

  const producido = await producidoPorOrden(db, [id]);

  const lotes = await db
    .select({
      id: batches.id,
      number: batches.number,
      producedAt: batches.producedAt,
      blockTypeId: batches.blockTypeId,
      blocksGood: batches.blocksGood,
      blocksBroken: batches.blocksBroken,
    })
    .from(batches)
    .where(and(eq(batches.productionOrderId, id), isNull(batches.deletedAt)))
    .orderBy(desc(batches.producedAt));

  // Que receta corre cada renglon. La planta necesita saberlo para no tener
  // que adivinar cual de las mezclas da ese bloque.
  const recetas = await db
    .select({ id: recipes.id, name: recipes.name, blockTypeId: recipes.blockTypeId, status: recipes.status })
    .from(recipes)
    .where(and(isNull(recipes.deletedAt), ne(recipes.status, "retired")));

  const lineas = renglones.map((r) => {
    const hecho = producido.get(`${id}:${r.blockTypeId}`) ?? 0;
    const suyas = recetas.filter((x) => x.blockTypeId === r.blockTypeId);
    return {
      ...r,
      producido: hecho,
      falta: Math.max(0, r.quantity - hecho),
      recetas: suyas,
    };
  });

  const falta = lineas.reduce((s, l) => s + l.falta, 0);
  return {
    ...orden,
    lines: lineas,
    lotes,
    pedido: lineas.reduce((s, l) => s + l.quantity, 0),
    producido: lineas.reduce((s, l) => s + l.producido, 0),
    falta,
    completa: falta === 0,
  };
}

/**
 * Cierra la orden sola cuando ya no falta nada.
 *
 * Se cierra sola a proposito: que la orden este terminada no es una opinion,
 * es un hecho que sale de sumar los lotes. Pedirle al maquinista que ademas
 * apriete un boton para confirmar lo que el sistema ya sabe es pedirle que
 * mantenga a mano un numero calculado, y eso es exactamente lo que este
 * sistema no hace en ninguna parte.
 *
 * Y se vuelve a abrir sola si un recuento la deja corta otra vez — pero SOLO
 * si fue ella la que se cerro. Una orden que cerro una persona diciendo «hasta
 * aca llegamos» no se reabre porque el maquinista corrigio un conteo: esa fue
 * una decision, y el software no revierte decisiones ajenas.
 *
 * Devuelve el aviso a mostrar, o null.
 */
const CERRADA_SOLA = "Se cerró sola: ya se produjo todo lo que pedía.";

export async function revisarOrden(tx: Tx, orderId: string, userId: string | null) {
  const [orden] = await tx.select().from(productionOrders).where(eq(productionOrders.id, orderId));
  if (!orden || orden.status === "anulada") return null;
  if (orden.status === "terminada" && orden.closeReason !== CERRADA_SOLA) return null;

  const renglones = await tx
    .select()
    .from(productionOrderLines)
    .where(eq(productionOrderLines.orderId, orderId));
  const producido = await producidoPorOrden(tx, [orderId]);
  const falta = renglones.reduce(
    (s, r) => s + Math.max(0, r.quantity - (producido.get(`${orderId}:${r.blockTypeId}`) ?? 0)),
    0,
  );

  if (falta === 0) {
    if (orden.status === "terminada") return null;
    await tx
      .update(productionOrders)
      .set({
        status: "terminada",
        closedAt: new Date(),
        closedBy: userId,
        closeReason: CERRADA_SOLA,
        updatedAt: new Date(),
      })
      .where(eq(productionOrders.id, orderId));
    return `La orden N° ${orden.number} quedó terminada: ya se produjo todo lo que pedía.`;
  }

  if (orden.status === "terminada") {
    await tx
      .update(productionOrders)
      .set({
        status: "en_proceso",
        closedAt: null,
        closedBy: null,
        closeReason: null,
        updatedAt: new Date(),
      })
      .where(eq(productionOrders.id, orderId));
    return `La orden N° ${orden.number} se había dado por terminada, pero con el recuento nuevo le faltan ${falta} bloques. Vuelve a estar abierta.`;
  }

  if (orden.status === "pendiente") {
    await tx
      .update(productionOrders)
      .set({ status: "en_proceso", updatedAt: new Date() })
      .where(eq(productionOrders.id, orderId));
  }
  return `A la orden N° ${orden.number} le faltan ${falta} bloques.`;
}

export async function ordenesRoutes(app: FastifyInstance) {
  /** La cola de la planta. Lo vivo primero, y dentro de lo vivo lo más urgente. */
  app.get("/ordenes", async (req) => {
    const { estado, quoteId } = req.query as { estado?: string; quoteId?: string };
    const filtro =
      estado === "vivas" || estado === undefined
        ? inArray(productionOrders.status, [...VIVAS])
        : estado === "todas"
          ? undefined
          : eq(productionOrders.status, estado as "terminada");

    const filas = await db
      .select()
      .from(productionOrders)
      .where(
        and(
          isNull(productionOrders.deletedAt),
          filtro,
          quoteId ? eq(productionOrders.quoteId, quoteId) : undefined,
        ),
      )
      .orderBy(desc(productionOrders.createdAt))
      .limit(200);

    const renglones =
      filas.length === 0
        ? []
        : await db
            .select()
            .from(productionOrderLines)
            .where(inArray(productionOrderLines.orderId, filas.map((f) => f.id)));
    const producido = await producidoPorOrden(db, filas.map((f) => f.id));

    return filas
      .map((o) => {
        const suyos = renglones.filter((r) => r.orderId === o.id);
        const pedido = suyos.reduce((s, r) => s + r.quantity, 0);
        const hecho = suyos.reduce(
          (s, r) => s + Math.min(r.quantity, producido.get(`${o.id}:${r.blockTypeId}`) ?? 0),
          0,
        );
        return {
          ...o,
          resumen: suyos.map((r) => r.description).join(", "),
          pedido,
          producido: hecho,
          falta: Math.max(0, pedido - hecho),
        };
      })
      .sort((a, b) => {
        // Lo que tiene fecha va antes que lo que no: una orden sin fecha no
        // es urgente, es una orden sin fecha.
        const fa = a.neededBy ? new Date(a.neededBy).getTime() : Infinity;
        const fb = b.neededBy ? new Date(b.neededBy).getTime() : Infinity;
        return fa - fb;
      });
  });

  app.get("/ordenes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ficha = await fichaDeLaOrden(id);
    if (!ficha) return reply.code(404).send({ error: "Esa orden no existe." });
    return ficha;
  });

  /**
   * Pasar una cotizacion a produccion.
   *
   * Es el boton que pidieron. Lo que hace por dentro es la parte interesante:
   * mira cada renglon, busca de que tipo de bloque es, descuenta lo que ya hay
   * en el patio y lo que otras ordenes vivas ya prometieron, y pide la
   * diferencia. Si no queda diferencia, no crea nada: avisa que ya esta hecho.
   */
  app.post("/ordenes/desde-cotizacion", async (req, reply) => {
    const body = desdeCotizacionSchema.parse(req.body);

    const [cot] = await db.select().from(quotes).where(eq(quotes.id, body.quoteId));
    if (!cot) return reply.code(400).send({ error: "Esa cotización no existe." });

    const [yaHay] = await db
      .select({ id: productionOrders.id, number: productionOrders.number })
      .from(productionOrders)
      .where(
        and(
          eq(productionOrders.quoteId, body.quoteId),
          inArray(productionOrders.status, [...VIVAS]),
          isNull(productionOrders.deletedAt),
        ),
      );
    if (yaHay) {
      return reply.code(409).send({
        error: `Esta cotización ya tiene la orden N° ${yaHay.number} abierta en la planta. Si hace falta fabricar más, cerrá esa primero o agregá lo que falta ahí mismo.`,
        ordenId: yaHay.id,
      });
    }

    const renglones = await db
      .select()
      .from(quoteLines)
      .where(and(eq(quoteLines.quoteId, body.quoteId), isNull(quoteLines.deletedAt)));

    const productos = await db.select().from(catalogItems);
    const tipos = await db.select().from(blockTypes);
    const stock = await existencias(db);
    const prometido = await comprometido(db);

    const avisos: string[] = [];
    const aFabricar: {
      blockTypeId: string;
      description: string;
      quantity: number;
      quoteLineId: string;
    }[] = [];

    for (const r of renglones) {
      const producto = r.catalogItemId ? productos.find((p) => p.id === r.catalogItemId) : undefined;
      const tipo = producto?.blockTypeId ? tipos.find((t) => t.id === producto.blockTypeId) : undefined;

      if (!tipo) {
        if (producto && producto.type === "product") {
          avisos.push(
            `«${r.description}» no está enlazado a ningún tipo de bloque, así que no entra en la orden. Enlazalo desde Productos si es algo que se fabrica.`,
          );
        }
        continue;
      }

      const enPatio = stock.get(tipo.id) ?? 0;
      const yaPrometido = prometido.get(tipo.id) ?? 0;
      const disponible = Math.max(0, enPatio - yaPrometido);
      const falta = Math.max(0, r.quantity - disponible);

      if (yaPrometido > 0 && enPatio > 0) {
        avisos.push(
          `De «${tipo.name}» hay ${enPatio} en el patio, pero ${yaPrometido} ya están prometidos a otras órdenes abiertas. Para esta cotización quedan ${disponible}.`,
        );
      }

      if (falta === 0) {
        avisos.push(
          `«${tipo.name}»: los ${r.quantity} que pide esta cotización ya están en el patio. No entra en la orden.`,
        );
        continue;
      }

      if (disponible > 0) {
        avisos.push(
          `De «${tipo.name}» hay ${disponible} disponibles, así que la orden pide sólo los ${falta} que faltan de los ${r.quantity}.`,
        );
      }

      aFabricar.push({
        blockTypeId: tipo.id,
        description: tipo.name,
        quantity: falta,
        quoteLineId: r.id,
      });
    }

    if (aFabricar.length === 0) {
      return reply.code(409).send({
        error:
          "No hay nada que fabricar: todo lo que pide esta cotización ya está en el patio, o ningún renglón es un bloque.",
        avisos,
      });
    }

    const nombreCliente =
      (cot.customerSnapshot as { name?: string } | null)?.name ?? null;

    const creada = await db.transaction(async (tx) => {
      const numero = await nextCorrelativo(tx, "production_order");
      const [orden] = await tx
        .insert(productionOrders)
        .values({
          number: numero,
          quoteId: body.quoteId,
          customerName: nombreCliente,
          neededBy: body.neededBy ?? null,
          notes: body.notes ?? null,
          createdBy: getUserId(req),
        })
        .returning();
      if (!orden) throw new Error("No se pudo crear la orden");

      await tx
        .insert(productionOrderLines)
        .values(aFabricar.map((l) => ({ ...l, orderId: orden.id })));

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "production_orders",
        entityId: orden.id,
        action: "create",
        newValues: { number: numero, quoteId: body.quoteId, lines: aFabricar },
      });
      return orden;
    });

    const ficha = await fichaDeLaOrden(creada.id);
    return reply.code(201).send({ ...ficha, avisos });
  });

  /** Una orden que no sale de ninguna cotización: producir para tener existencia. */
  app.post("/ordenes", async (req, reply) => {
    const body = sueltaSchema.parse(req.body);

    const tipos = await db
      .select()
      .from(blockTypes)
      .where(inArray(blockTypes.id, body.lines.map((l) => l.blockTypeId)));
    const faltantes = body.lines.filter((l) => !tipos.some((t) => t.id === l.blockTypeId));
    if (faltantes.length > 0) {
      return reply.code(400).send({ error: "Hay tipos de bloque que no existen." });
    }

    const creada = await db.transaction(async (tx) => {
      const numero = await nextCorrelativo(tx, "production_order");
      const [orden] = await tx
        .insert(productionOrders)
        .values({
          number: numero,
          customerName: body.customerName ?? null,
          neededBy: body.neededBy ?? null,
          notes: body.notes ?? null,
          createdBy: getUserId(req),
        })
        .returning();
      if (!orden) throw new Error("No se pudo crear la orden");

      await tx.insert(productionOrderLines).values(
        body.lines.map((l) => ({
          orderId: orden.id,
          blockTypeId: l.blockTypeId,
          description: tipos.find((t) => t.id === l.blockTypeId)?.name ?? "Bloque",
          quantity: l.quantity,
        })),
      );

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "production_orders",
        entityId: orden.id,
        action: "create",
        newValues: { number: numero, lines: body.lines },
      });
      return orden;
    });

    return reply.code(201).send(await fichaDeLaOrden(creada.id));
  });

  /**
   * Cerrar una orden antes de completarla.
   *
   * Pasa todo el tiempo y no es un error: el cliente se conformo con menos, o
   * se decidio no seguir. Lo que no puede pasar es que se cierre sin decir por
   * que, porque dentro de tres meses la pregunta va a ser «¿y por que esta
   * orden quedo en 380 de 600?».
   */
  app.post("/ordenes/:id/cerrar", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { reason } = z
      .object({ reason: z.string().min(3, "Decí por qué se cierra esta orden.") })
      .parse(req.body);

    const ficha = await fichaDeLaOrden(id);
    if (!ficha) return reply.code(404).send({ error: "Esa orden no existe." });
    if (ficha.status === "anulada" || ficha.status === "terminada") {
      return reply.code(409).send({ error: "Esa orden ya está cerrada." });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(productionOrders)
        .set({
          status: "terminada",
          closedAt: new Date(),
          closedBy: getUserId(req),
          closeReason: reason.trim(),
          updatedAt: new Date(),
        })
        .where(eq(productionOrders.id, id));
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "production_orders",
        entityId: id,
        action: "update",
        newValues: { status: "terminada", closeReason: reason.trim() },
      });
    });

    return {
      ...(await fichaDeLaOrden(id)),
      avisos:
        ficha.falta > 0
          ? [
              `Se cerró con ${ficha.producido} de ${ficha.pedido} bloques: quedaron ${ficha.falta} sin fabricar. Lo que ya se produjo sigue en el patio.`,
            ]
          : [],
    };
  });

  /**
   * Anular: esta orden no debio existir.
   *
   * Es distinto de cerrarla. Cerrar dice «hasta aca llegamos»; anular dice «no
   * iba». Los lotes que se hayan corrido contra ella NO se tocan: el bloque
   * existe, esta en el patio, y borrarlo del inventario porque la orden se
   * anulo seria hacer desaparecer producto real.
   */
  app.post("/ordenes/:id/anular", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { reason } = z
      .object({ reason: z.string().min(3, "Decí por qué se anula esta orden.") })
      .parse(req.body);

    const ficha = await fichaDeLaOrden(id);
    if (!ficha) return reply.code(404).send({ error: "Esa orden no existe." });
    if (ficha.status === "anulada") return reply.code(409).send({ error: "Esa orden ya está anulada." });

    await db.transaction(async (tx) => {
      await tx
        .update(productionOrders)
        .set({
          status: "anulada",
          closedAt: new Date(),
          closedBy: getUserId(req),
          closeReason: reason.trim(),
          updatedAt: new Date(),
        })
        .where(eq(productionOrders.id, id));
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "production_orders",
        entityId: id,
        action: "update",
        newValues: { status: "anulada", closeReason: reason.trim() },
      });
    });

    return {
      ...(await fichaDeLaOrden(id)),
      avisos:
        ficha.producido > 0
          ? [
              `Se anuló, pero los ${ficha.producido} bloques que ya se habían producido siguen en el patio. El bloque existe aunque la orden no.`,
            ]
          : [],
    };
  });
}
