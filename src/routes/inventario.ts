import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { catalogItems, inventoryMoves, quoteLines, quotes } from "../db/schema.js";
import { batches, blockTypes } from "../db/schema-bloques.js";
import { logActivity } from "../lib/activity-log.js";
import { getUserId } from "../lib/request-context.js";
import { pendientePorFacturar } from "./invoices.js";
import { reservadoPorTipo } from "../lib/reservas.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ajusteSchema = z.object({
  blockTypeId: z.string().uuid(),
  quantity: z.number().int().refine((n) => n !== 0, "Un ajuste de cero no ajusta nada."),
  reason: z.enum(["ajuste", "rotura", "devolucion"]).default("ajuste"),
  note: z.string().min(3, "Decí por qué se ajusta: un número que cambió sin explicación no sirve de nada."),
});

/**
 * Cuantos hay de cada tipo de bloque, sumando movimientos.
 *
 * No hay ninguna columna "existencia" que leer: el numero se calcula siempre.
 * Es mas lento que guardar un contador y es a proposito — un contador se
 * desincroniza una vez y ya nadie vuelve a creerle.
 */
export async function existencias(tx: Tx | typeof db) {
  const filas = await tx
    .select({
      blockTypeId: inventoryMoves.blockTypeId,
      cantidad: sql<number>`sum(${inventoryMoves.quantity})::int`,
    })
    .from(inventoryMoves)
    .groupBy(inventoryMoves.blockTypeId);
  return new Map(filas.map((f) => [f.blockTypeId, Number(f.cantidad) || 0]));
}

/** Cuantos hay de un tipo. Cero cuando nunca entro ni salio nada. */
export async function existenciaDe(tx: Tx | typeof db, blockTypeId: string): Promise<number> {
  const [fila] = await tx
    .select({ cantidad: sql<number>`coalesce(sum(${inventoryMoves.quantity}), 0)::int` })
    .from(inventoryMoves)
    .where(eq(inventoryMoves.blockTypeId, blockTypeId));
  return Number(fila?.cantidad) || 0;
}

/** Anota un movimiento. La unica forma de que el inventario cambie. */
export async function moverInventario(
  tx: Tx,
  m: {
    blockTypeId: string;
    quantity: number;
    reason: "produccion" | "venta" | "ajuste" | "rotura" | "devolucion";
    refType?: string;
    refId?: string;
    note?: string;
    userId: string | null;
  },
) {
  if (m.quantity === 0) return;
  await tx.insert(inventoryMoves).values({
    blockTypeId: m.blockTypeId,
    quantity: m.quantity,
    reason: m.reason,
    refType: m.refType ?? null,
    refId: m.refId ?? null,
    note: m.note ?? null,
    createdBy: m.userId,
  });
}

export async function inventarioRoutes(app: FastifyInstance) {
  /** La existencia de cada tipo de bloque, con su equivalente en el catalogo. */
  app.get("/inventario", async () => {
    const tipos = await db.select().from(blockTypes).where(eq(blockTypes.active, true));
    const stock = await existencias(db);
    const apartado = await reservadoPorTipo(db);
    const productos = await db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.active, true));

    /**
     * Cuantos lotes se corrieron de cada tipo, y cuando fue el ultimo.
     *
     * No es lo mismo que la existencia y las dos cosas importan: la existencia
     * dice cuanto hay para entregar hoy, y los lotes dicen cuanto se viene
     * fabricando. Un tipo con muchos lotes y poca existencia se vende bien; uno
     * con un lote y todo en el patio, no.
     */
    const lotes = await db
      .select({
        blockTypeId: batches.blockTypeId,
        cuantos: sql<number>`count(*)::int`,
        ultimo: sql<string | null>`max(${batches.producedAt})`,
      })
      .from(batches)
      .groupBy(batches.blockTypeId);
    const porTipo = new Map(lotes.map((l) => [l.blockTypeId, l]));

    return tipos.map((t) => {
      const producto = productos.find((p) => p.blockTypeId === t.id);
      const l = porTipo.get(t.id);
      return {
        blockTypeId: t.id,
        code: t.code,
        name: t.name,
        existencia: stock.get(t.id) ?? 0,
        // Apartado para pedidos abiertos, y lo que queda libre para vender.
        reservado: apartado.get(t.id)?.cantidad ?? 0,
        pedidosConReserva: apartado.get(t.id)?.pedidos ?? [],
        disponible: (stock.get(t.id) ?? 0) - (apartado.get(t.id)?.cantidad ?? 0),
        lotes: Number(l?.cuantos) || 0,
        ultimoLote: l?.ultimo ?? null,
        // Que producto del catalogo corresponde a este bloque, si alguno.
        // Sin esto no se puede saber si lo que un cliente pide ya esta hecho.
        catalogItemId: producto?.id ?? null,
        catalogItemName: producto?.name ?? null,
        unitPriceCents: producto?.unitPriceCents ?? null,
      };
    });
  });

  /** El detalle: de donde salio y adonde se fue cada bloque. */
  app.get("/inventario/:blockTypeId/movimientos", async (req) => {
    const { blockTypeId } = req.params as { blockTypeId: string };
    return db
      .select()
      .from(inventoryMoves)
      .where(eq(inventoryMoves.blockTypeId, blockTypeId))
      .orderBy(desc(inventoryMoves.notedAt))
      .limit(200);
  });

  /**
   * Corregir la existencia a mano.
   *
   * Hace falta desde el primer dia: el inventario arranco sumando los lotes ya
   * producidos, que es lo unico que el sistema sabia, y casi seguro no es la
   * cantidad que hay en el patio. Se corrige con un movimiento, no editando un
   * numero, para que la correccion tambien quede explicada.
   */
  app.post("/inventario/ajuste", async (req, reply) => {
    const body = ajusteSchema.parse(req.body);

    const [tipo] = await db.select().from(blockTypes).where(eq(blockTypes.id, body.blockTypeId));
    if (!tipo) return reply.code(400).send({ error: "Ese tipo de bloque no existe." });

    const antes = await existenciaDe(db, body.blockTypeId);

    await db.transaction(async (tx) => {
      await moverInventario(tx, {
        blockTypeId: body.blockTypeId,
        quantity: body.quantity,
        reason: body.reason,
        note: body.note.trim(),
        userId: getUserId(req),
      });
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "inventory_moves",
        entityId: body.blockTypeId,
        action: "create",
        newValues: { quantity: body.quantity, reason: body.reason, note: body.note.trim() },
      });
    });

    const despues = antes + body.quantity;
    return {
      blockTypeId: body.blockTypeId,
      existencia: despues,
      avisos:
        despues < 0
          ? [
              `La existencia de «${tipo.name}» quedó en ${despues}. Un negativo casi siempre significa que faltó registrar producción, no que haya bloques de menos.`,
            ]
          : [],
    };
  });

  /**
   * Que hace falta fabricar para poder entregar esta cotizacion.
   *
   * Es la pregunta que cierra el circulo: de los 1.000 bloques que pidio el
   * cliente, cuantos ya estan en el patio y cuantos hay que producir. Antes no
   * se podia contestar porque el catalogo y los tipos de bloque no se conocian.
   */
  app.get("/quotes/:id/que-producir", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [cot] = await db.select().from(quotes).where(eq(quotes.id, id));
    if (!cot) return reply.code(404).send({ error: "Esa cotización no existe." });

    const renglones = await db
      .select()
      .from(quoteLines)
      .where(and(eq(quoteLines.quoteId, id), isNull(quoteLines.deletedAt)));

    const stock = await existencias(db);
    // Lo apartado para OTROS pedidos no esta libre para esta cotizacion; lo
    // apartado para su propio pedido si.
    const apartadoAjeno = await reservadoPorTipo(db, { exceptoCotizacion: id });
    const productos = await db.select().from(catalogItems);
    const tipos = await db.select().from(blockTypes);

    // Lo ya facturado ya salio del patio: no se vuelve a pedir fabricarlo. Sin
    // esto, una cotizacion entregada por completo diria "faltan 1.000".
    const pendiente = new Map(
      (await pendientePorFacturar(db as never, id)).map((p) => [p.quoteLineId, p.pendiente]),
    );

    const lineas = renglones.map((r) => {
      const porEntregar = Math.max(0, pendiente.get(r.id) ?? r.quantity);
      const producto = r.catalogItemId ? productos.find((p) => p.id === r.catalogItemId) : undefined;
      const tipo = producto?.blockTypeId ? tipos.find((t) => t.id === producto.blockTypeId) : undefined;

      // Sin tipo de bloque no hay nada que producir: es mano de obra, flete,
      // alquiler. O es un bloque al que nadie le dijo cual es.
      if (!tipo) {
        return {
          quoteLineId: r.id,
          description: r.description,
          pedido: r.quantity,
          esProducible: false,
          sinEnlazar: Boolean(producto && producto.type === "product"),
          enExistencia: null,
          hayQueProducir: null,
          blockTypeId: null,
          blockTypeName: null,
        };
      }

      const ajeno = apartadoAjeno.get(tipo.id)?.cantidad ?? 0;
      const hay = Math.max(0, (stock.get(tipo.id) ?? 0) - ajeno);
      return {
        apartadoParaOtros: ajeno,
        quoteLineId: r.id,
        description: r.description,
        pedido: r.quantity,
        esProducible: true,
        sinEnlazar: false,
        enExistencia: hay,
        yaFacturado: r.quantity - porEntregar,
        // Nunca negativo: si sobra existencia, lo que falta producir es cero.
        hayQueProducir: Math.max(0, porEntregar - hay),
        blockTypeId: tipo.id,
        blockTypeName: tipo.name,
      };
    });

    const producibles = lineas.filter((l) => l.esProducible);
    const cubiertas = producibles.filter((l) => l.hayQueProducir === 0);
    const sinEnlazar = lineas.filter((l) => l.sinEnlazar);

    const avisos: string[] = [];
    if (producibles.length > 0 && cubiertas.length === producibles.length) {
      avisos.push("Todo lo que pide esta cotización ya está en el patio. No hace falta producir nada.");
    } else {
      for (const l of producibles) {
        if (l.hayQueProducir === 0) {
          avisos.push(`De «${l.description}» ya hay ${l.enExistencia} en el patio: no hace falta producir.`);
        } else if ((l as { apartadoParaOtros?: number }).apartadoParaOtros && (l.enExistencia ?? 0) === 0) {
          avisos.push(
            `De «${l.description}» hay bloques en el patio, pero están apartados para otros pedidos: faltan ${l.hayQueProducir} por producir.`,
          );
        } else if ((l.enExistencia ?? 0) > 0) {
          avisos.push(
            `De «${l.description}» hay ${l.enExistencia} en el patio, así que sólo faltan ${l.hayQueProducir} de los ${l.pedido} pedidos.`,
          );
        }
      }
    }
    for (const l of sinEnlazar) {
      avisos.push(
        `«${l.description}» no está enlazado a ningún tipo de bloque, así que el sistema no puede saber si ya está fabricado. Enlazalo desde Productos.`,
      );
    }

    return { quoteId: id, lines: lineas, avisos };
  });

  /**
   * Decirle al sistema que este producto del catalogo ES este tipo de bloque.
   *
   * Es el puente que faltaba, y es lo que permite que una cotizacion sepa si
   * lo que pide ya esta fabricado.
   */
  app.patch("/catalog-items/:id/tipo-bloque", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { blockTypeId } = z
      .object({ blockTypeId: z.string().uuid().nullable() })
      .parse(req.body);

    if (blockTypeId) {
      const [tipo] = await db.select().from(blockTypes).where(eq(blockTypes.id, blockTypeId));
      if (!tipo) return reply.code(400).send({ error: "Ese tipo de bloque no existe." });

      // Un tipo de bloque se vende como un solo producto: si dos productos
      // apuntaran al mismo, la existencia se descontaria dos veces.
      const [ocupado] = await db
        .select()
        .from(catalogItems)
        .where(and(eq(catalogItems.blockTypeId, blockTypeId), eq(catalogItems.active, true)));
      if (ocupado && ocupado.id !== id) {
        return reply.code(409).send({
          error: `«${ocupado.name}» ya está enlazado a ese tipo de bloque. Un tipo de bloque se vende como un solo producto.`,
        });
      }
    }

    const [actualizado] = await db
      .update(catalogItems)
      .set({ blockTypeId, updatedAt: new Date() })
      .where(eq(catalogItems.id, id))
      .returning();
    if (!actualizado) return reply.code(404).send({ error: "Ese producto no existe." });
    return actualizado;
  });
}
