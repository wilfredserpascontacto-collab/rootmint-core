import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { db as Db } from "../db/client.js";
import {
  catalogItems,
  invoiceLines,
  invoices,
  salesOrderLines,
  salesOrders,
} from "../db/schema.js";

type Lector = Pick<typeof Db, "select">;

/**
 * Cuanto se ha facturado de cada renglon de pedido.
 *
 * Cuenta dos caminos, porque la gente factura de dos maneras: desde el pedido
 * (la linea de factura apunta al renglon) o desde la cotizacion de la que salio
 * el pedido (apunta al renglon de la cotizacion). Una linea que apunta a los
 * dos se cuenta una sola vez, por el renglon de pedido.
 *
 * Solo cuentan las facturas emitidas: anular una devuelve lo facturado, y con
 * ello la reserva, sin que nadie tenga que acordarse.
 */
export async function facturadoPorRenglon(
  tx: Lector,
  renglones: { id: string; quoteLineId: string | null }[],
): Promise<Map<string, number>> {
  const resultado = new Map<string, number>(renglones.map((r) => [r.id, 0]));
  if (renglones.length === 0) return resultado;

  const ids = renglones.map((r) => r.id);
  const quoteIds = renglones.map((r) => r.quoteLineId).filter((x): x is string => Boolean(x));

  const lineas = await tx
    .select({
      salesOrderLineId: invoiceLines.salesOrderLineId,
      quoteLineId: invoiceLines.quoteLineId,
      quantity: invoiceLines.quantity,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(
      and(
        eq(invoices.status, "issued"),
        or(
          inArray(invoiceLines.salesOrderLineId, ids),
          quoteIds.length ? inArray(invoiceLines.quoteLineId, quoteIds) : undefined,
        ),
      ),
    );

  const porCotizacion = new Map(
    renglones.filter((r) => r.quoteLineId).map((r) => [r.quoteLineId as string, r.id]),
  );
  for (const l of lineas) {
    const destino = l.salesOrderLineId ?? (l.quoteLineId ? porCotizacion.get(l.quoteLineId) : undefined);
    if (destino && resultado.has(destino)) resultado.set(destino, (resultado.get(destino) ?? 0) + l.quantity);
  }
  return resultado;
}

/** Lo que sigue apartado: lo apartado menos lo ya facturado, nunca negativo. */
export const reservaVigente = (apartado: number, facturado: number) => Math.max(0, apartado - facturado);

/**
 * Cuantos bloques de cada tipo estan apartados por pedidos abiertos.
 *
 * `exceptoPedido` y `exceptoCotizacion` sirven para preguntar «cuanto me
 * queda a MI»: una cotizacion que ya tiene su pedido no debe competir contra
 * su propia reserva.
 */
export async function reservadoPorTipo(
  tx: Lector,
  opciones: { exceptoPedido?: string; exceptoCotizacion?: string } = {},
): Promise<Map<string, { cantidad: number; pedidos: number[] }>> {
  const filas = await tx
    .select({
      id: salesOrderLines.id,
      orderId: salesOrderLines.orderId,
      numero: salesOrders.number,
      quoteId: salesOrders.quoteId,
      quoteLineId: salesOrderLines.quoteLineId,
      apartado: salesOrderLines.reservedQuantity,
      blockTypeId: catalogItems.blockTypeId,
    })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
    .innerJoin(catalogItems, eq(catalogItems.id, salesOrderLines.catalogItemId))
    .where(
      and(
        eq(salesOrders.status, "abierto"),
        isNull(salesOrders.deletedAt),
        isNull(salesOrderLines.deletedAt),
      ),
    );

  const utiles = filas.filter(
    (f) =>
      f.blockTypeId &&
      f.apartado > 0 &&
      f.orderId !== opciones.exceptoPedido &&
      !(opciones.exceptoCotizacion && f.quoteId === opciones.exceptoCotizacion),
  );
  const facturado = await facturadoPorRenglon(tx, utiles);

  const mapa = new Map<string, { cantidad: number; pedidos: number[] }>();
  for (const f of utiles) {
    const vigente = reservaVigente(f.apartado, facturado.get(f.id) ?? 0);
    if (vigente === 0 || !f.blockTypeId) continue;
    const previo = mapa.get(f.blockTypeId) ?? { cantidad: 0, pedidos: [] };
    previo.cantidad += vigente;
    if (!previo.pedidos.includes(f.numero)) previo.pedidos.push(f.numero);
    mapa.set(f.blockTypeId, previo);
  }
  return mapa;
}
