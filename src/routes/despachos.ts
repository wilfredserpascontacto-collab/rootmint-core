import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  catalogItems,
  customers,
  deliveries,
  deliveryLines,
  deliveryPhotos,
  inventoryMoves,
  invoiceLines,
  invoices,
  salesOrderLines,
  salesOrders,
} from "../db/schema.js";
import { logActivity } from "../lib/activity-log.js";
import { nextCorrelativo } from "../lib/counters.js";
import { getUserId } from "../lib/request-context.js";
import { existenciaDe, moverInventario } from "./inventario.js";
import { reservadoPorTipo } from "../lib/reservas.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Cuanto pesa, como mucho, lo que trae un despacho.
 *
 * Una firma dibujada con el dedo son unos pocos KB; una foto que el telefono
 * ya achico, unos cientos. Los topes existen para que un telefono que mande la
 * foto SIN achicar reciba un «no» claro en vez de tumbar el servidor.
 */
const TOPE_FIRMA = 400_000; // caracteres de dataURL, ~300 KB de imagen
const TOPE_FOTO = 2_000_000; // ~1.5 MB de imagen
const TOPE_FOTOS = 6;
/** El cuerpo entero: seis fotos al tope, la firma y los renglones, con holgura. */
const TOPE_CUERPO = 16 * 1024 * 1024;

const esImagen = (s: string) => /^data:image\/(png|jpeg|jpg|webp);base64,/.test(s);

const fotoSchema = z.object({
  dataUrl: z
    .string()
    .max(TOPE_FOTO, "Esa foto pesa demasiado. Achicala en el teléfono antes de subirla.")
    .refine(esImagen, "Eso no es una foto."),
  caption: z.string().max(200).optional(),
});

const renglonSchema = z
  .object({
    catalogItemId: z.string().uuid().optional(),
    invoiceLineId: z.string().uuid().optional(),
    salesOrderLineId: z.string().uuid().optional(),
    description: z.string().min(1).max(300).optional(),
    quantity: z.number().int().positive("Entregar cero no es entregar."),
  })
  /**
   * Un renglon tiene que decir QUE se entrega.
   *
   * Sin esto, un renglon que no apunta a nada se guardaba igual, con la
   * descripcion «Sin descripcion» y sin tipo de bloque: el despacho se creaba,
   * se veia bien en pantalla, y el patio no se movia ni un bloque. El papel
   * decia que salieron doscientos y el sistema seguia contandolos adentro.
   */
  .refine((l) => l.catalogItemId || l.invoiceLineId || l.salesOrderLineId, {
    message: "Cada renglón tiene que decir qué producto se entrega.",
  });

const despachoSchema = z
  .object({
    customerId: z.string().uuid().optional(),
    invoiceId: z.string().uuid().optional(),
    salesOrderId: z.string().uuid().optional(),
    deliveredAt: z.coerce.date().optional(),
    receivedByName: z.string().min(2, "Hace falta el nombre de quien recibe.").max(200),
    receivedByDocument: z.string().max(60).optional(),
    address: z.string().max(300).optional(),
    driverName: z.string().max(200).optional(),
    vehiclePlate: z.string().max(30).optional(),
    notes: z.string().max(2000).optional(),
    signature: z
      .string()
      .max(TOPE_FIRMA, "La firma pesa demasiado.")
      .refine(esImagen, "Eso no es una firma.")
      .optional(),
    fotos: z.array(fotoSchema).max(TOPE_FOTOS, `No más de ${TOPE_FOTOS} fotos por despacho.`).optional(),
    lines: z.array(renglonSchema).min(1, "Un despacho sin renglones no entrega nada."),
  })
  .refine((b) => b.customerId || b.invoiceId || b.salesOrderId, {
    message: "Decí a quién se le entrega: un cliente, una factura o un pedido.",
  });

const anularSchema = z.object({
  reason: z.string().min(3, "Decí por qué se anula: un despacho borrado sin motivo no se puede explicar."),
});

/**
 * Cuanto se ha entregado ya de cada renglon de factura.
 *
 * Solo cuentan los despachos vivos: anular uno devuelve lo entregado, y con
 * ello lo que queda por despachar, sin que nadie tenga que acordarse.
 */
export async function entregadoPorRenglonFactura(
  tx: Pick<typeof db, "select">,
  invoiceLineIds: string[],
): Promise<Map<string, number>> {
  const resultado = new Map<string, number>(invoiceLineIds.map((id) => [id, 0]));
  if (invoiceLineIds.length === 0) return resultado;
  const filas = await tx
    .select({ invoiceLineId: deliveryLines.invoiceLineId, quantity: deliveryLines.quantity })
    .from(deliveryLines)
    .innerJoin(deliveries, eq(deliveries.id, deliveryLines.deliveryId))
    .where(
      and(
        eq(deliveries.status, "entregado"),
        isNull(deliveries.deletedAt),
        isNull(deliveryLines.deletedAt),
        inArray(deliveryLines.invoiceLineId, invoiceLineIds),
      ),
    );
  for (const f of filas) {
    if (!f.invoiceLineId) continue;
    resultado.set(f.invoiceLineId, (resultado.get(f.invoiceLineId) ?? 0) + f.quantity);
  }
  return resultado;
}

/**
 * Bloques vendidos que todavia estan en el patio: facturados y sin despachar.
 *
 * Es el numero que faltaba. Antes, facturar sacaba el bloque del patio en el
 * acto, asi que esto no existia: el patio simplemente mentia al reves. Ahora el
 * bloque se queda hasta que sale el camion, y entonces hay que decir cuanto de
 * lo que se ve ya tiene dueno, o se vende dos veces.
 *
 * No se pisa con la reserva de un pedido: la reserva vigente ya descuenta lo
 * facturado (ver lib/reservas.ts), asi que lo que sale de reservado entra aca.
 */
export async function porDespacharPorTipo(
  tx: Pick<typeof db, "select">,
): Promise<Map<string, { cantidad: number; facturas: number[] }>> {
  const filas = await tx
    .select({
      lineaId: invoiceLines.id,
      numero: invoices.number,
      cantidad: invoiceLines.quantity,
      blockTypeId: catalogItems.blockTypeId,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .innerJoin(catalogItems, eq(catalogItems.id, invoiceLines.catalogItemId))
    .where(and(eq(invoices.status, "issued"), isNull(invoices.deletedAt)));

  const utiles = filas.filter((f) => f.blockTypeId);
  const entregado = await entregadoPorRenglonFactura(
    tx,
    utiles.map((f) => f.lineaId),
  );

  const mapa = new Map<string, { cantidad: number; facturas: number[] }>();
  for (const f of utiles) {
    const falta = f.cantidad - (entregado.get(f.lineaId) ?? 0);
    if (falta <= 0 || !f.blockTypeId) continue;
    const previo = mapa.get(f.blockTypeId) ?? { cantidad: 0, facturas: [] };
    previo.cantidad += falta;
    if (!previo.facturas.includes(f.numero)) previo.facturas.push(f.numero);
    mapa.set(f.blockTypeId, previo);
  }
  return mapa;
}

type RenglonDespacho = z.infer<typeof renglonSchema>;

/**
 * Arma el despacho y saca los bloques del patio, todo en el mismo acto.
 *
 * Vive aparte de la ruta porque la factura que se entrega en el momento la
 * llama tambien: el que llega, paga y carga hace una sola cosa en la pantalla,
 * aunque por dentro queden los dos papeles.
 *
 * No se impide entregar cuando el patio no alcanza —el bloque ya se subio al
 * camion, negarlo no lo baja— pero se avisa, porque un negativo que nadie ve no
 * se corrige nunca.
 */
export async function crearDespacho(
  tx: Tx,
  datos: {
    customerId: string;
    customerName: string;
    invoiceId?: string | null;
    salesOrderId?: string | null;
    deliveredAt?: Date;
    receivedByName: string;
    receivedByDocument?: string | null;
    address?: string | null;
    driverName?: string | null;
    vehiclePlate?: string | null;
    notes?: string | null;
    /** Como aparece en el historial del patio, p. ej. «Despacho N° 3 · CCF-00012». */
    referencia?: string | null;
    signature?: string | null;
    fotos?: { dataUrl: string; caption?: string }[];
    lines: RenglonDespacho[];
    userId: string | null;
  },
): Promise<{ despacho: typeof deliveries.$inferSelect; avisos: string[] }> {
  const avisos: string[] = [];

  /**
   * De donde sale el nombre y el tipo de bloque de cada renglon.
   *
   * Si el renglon viene de una factura, manda la factura: lo que se entrega es
   * lo que se facturo, con el nombre congelado de ese dia, aunque el producto
   * se haya renombrado desde entonces.
   */
  const idsFactura = datos.lines.map((l) => l.invoiceLineId).filter((x): x is string => Boolean(x));
  const deFactura = idsFactura.length
    ? await tx.select().from(invoiceLines).where(inArray(invoiceLines.id, idsFactura))
    : [];
  const porIdFactura = new Map(deFactura.map((l) => [l.id, l]));

  const idsPedido = datos.lines.map((l) => l.salesOrderLineId).filter((x): x is string => Boolean(x));
  const dePedido = idsPedido.length
    ? await tx.select().from(salesOrderLines).where(inArray(salesOrderLines.id, idsPedido))
    : [];
  const porIdPedido = new Map(dePedido.map((l) => [l.id, l]));

  const idsProducto = [
    ...new Set(
      datos.lines
        .map((l) => l.catalogItemId ?? porIdFactura.get(l.invoiceLineId ?? "")?.catalogItemId ?? porIdPedido.get(l.salesOrderLineId ?? "")?.catalogItemId)
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  const productos = idsProducto.length
    ? await tx.select().from(catalogItems).where(inArray(catalogItems.id, idsProducto))
    : [];
  const porProducto = new Map(productos.map((p) => [p.id, p]));

  const armados = datos.lines.map((l, i) => {
    // Un renglon que apunta a algo que no existe es un error de quien llama, no
    // un renglon sin producto: se corta aca y no se guarda a medias.
    if (l.invoiceLineId && !porIdFactura.has(l.invoiceLineId)) {
      throw Object.assign(new Error("Ese renglón de la factura no existe."), { statusCode: 400 });
    }
    if (l.salesOrderLineId && !porIdPedido.has(l.salesOrderLineId)) {
      throw Object.assign(new Error("Ese renglón del pedido no existe."), { statusCode: 400 });
    }
    const lineaFactura = l.invoiceLineId ? porIdFactura.get(l.invoiceLineId) : undefined;
    const lineaPedido = l.salesOrderLineId ? porIdPedido.get(l.salesOrderLineId) : undefined;
    const catalogItemId =
      l.catalogItemId ?? lineaFactura?.catalogItemId ?? lineaPedido?.catalogItemId ?? null;
    const producto = catalogItemId ? porProducto.get(catalogItemId) : undefined;
    const description =
      l.description ?? lineaFactura?.description ?? lineaPedido?.description ?? producto?.name ?? "Sin descripción";
    return {
      catalogItemId,
      blockTypeId: producto?.blockTypeId ?? null,
      invoiceLineId: l.invoiceLineId ?? null,
      salesOrderLineId: l.salesOrderLineId ?? lineaFactura?.salesOrderLineId ?? null,
      description,
      quantity: l.quantity,
      displayOrder: i,
    };
  });

  /**
   * Nada de lo que sale tiene patio: casi seguro es un error.
   *
   * Un despacho de puro flete existe y es valido. Uno donde NINGUN renglon
   * mueve el patio, habiendo bloques de por medio, es un papel que dice que
   * salio algo que el sistema sigue contando adentro. Se avisa, no se impide.
   */
  if (armados.every((a) => !a.blockTypeId)) {
    avisos.push(
      "Este despacho no movió el patio: ninguno de sus renglones está enlazado a un tipo de bloque. Si salieron bloques de verdad, enlazá el producto en Productos → enlazar.",
    );
  }

  /**
   * No se entrega mas de lo facturado.
   *
   * Sin esto, dos toques del boton en una tablet con mala senal sacan el doble
   * de bloques del patio contra la misma factura, y el patio queda mintiendo
   * sin que nadie sepa por que.
   */
  if (idsFactura.length) {
    const yaEntregado = await entregadoPorRenglonFactura(tx, idsFactura);
    for (const a of armados) {
      if (!a.invoiceLineId) continue;
      const linea = porIdFactura.get(a.invoiceLineId);
      if (!linea) continue;
      const falta = linea.quantity - (yaEntregado.get(a.invoiceLineId) ?? 0);
      if (a.quantity > falta) {
        throw Object.assign(
          new Error(
            falta <= 0
              ? `De «${linea.description}» ya se entregó todo lo que esa factura dice. Si se entregó de más, hace falta otra factura.`
              : `De «${linea.description}» la factura dice ${linea.quantity} y ya se entregaron ${linea.quantity - falta}: quedan ${falta}, no ${a.quantity}.`,
          ),
          { statusCode: 409 },
        );
      }
    }
  }

  const number = await nextCorrelativo(tx, "delivery");

  const [despacho] = await tx
    .insert(deliveries)
    .values({
      number,
      customerId: datos.customerId,
      customerName: datos.customerName,
      invoiceId: datos.invoiceId ?? null,
      salesOrderId: datos.salesOrderId ?? null,
      deliveredAt: datos.deliveredAt ?? new Date(),
      receivedByName: datos.receivedByName.trim(),
      receivedByDocument: datos.receivedByDocument?.trim() || null,
      address: datos.address?.trim() || null,
      driverName: datos.driverName?.trim() || null,
      vehiclePlate: datos.vehiclePlate?.trim() || null,
      notes: datos.notes?.trim() || null,
      signature: datos.signature ?? null,
      createdBy: datos.userId,
    })
    .returning();
  if (!despacho) throw new Error("No se pudo crear el despacho.");

  await tx.insert(deliveryLines).values(armados.map((a) => ({ ...a, deliveryId: despacho.id })));

  if (datos.fotos?.length) {
    await tx.insert(deliveryPhotos).values(
      datos.fotos.map((f) => ({
        deliveryId: despacho.id,
        dataUrl: f.dataUrl,
        caption: f.caption?.trim() || null,
        createdBy: datos.userId,
      })),
    );
  }

  // --- Lo que sale del patio, sale aca ---------------------------------------
  const porTipo = new Map<string, { cantidad: number; nombre: string }>();
  for (const a of armados) {
    if (!a.blockTypeId) continue;
    const previo = porTipo.get(a.blockTypeId);
    porTipo.set(a.blockTypeId, {
      cantidad: (previo?.cantidad ?? 0) + a.quantity,
      nombre: a.description,
    });
  }
  for (const [blockTypeId, { cantidad, nombre }] of porTipo) {
    const antes = await existenciaDe(tx, blockTypeId);
    await moverInventario(tx, {
      blockTypeId,
      quantity: -cantidad,
      reason: "venta",
      refType: "delivery",
      refId: despacho.id,
      note: `Despacho N° ${despacho.number}${datos.referencia ? " · " + datos.referencia : ""}`,
      userId: datos.userId,
    });
    if (antes - cantidad < 0) {
      avisos.push(
        `De «${nombre}» el patio tenía ${antes} y se despacharon ${cantidad}: quedó en ${antes - cantidad}. Casi siempre significa que faltó registrar producción, no que falten bloques.`,
      );
    } else {
      /**
       * Habia bloques, pero quiza estaban prometidos a otro.
       *
       * Este aviso vivia en la factura, cuando era ella la que descontaba el
       * patio. Al mudar el descuento al despacho se habia quedado atras, y la
       * venta de mostrador que se llevaba los bloques apartados de una obra
       * pasaba en silencio: nadie se enteraba hasta que el camion llegaba a la
       * obra y faltaban ciento cincuenta.
       */
      const apartado = (await reservadoPorTipo(tx)).get(blockTypeId);
      if (apartado && antes - cantidad < apartado.cantidad) {
        const falta = apartado.cantidad - (antes - cantidad);
        avisos.push(
          `Esta entrega se llevó bloques de «${nombre}» que estaban apartados para el pedido N° ${apartado.pedidos.join(", N° ")}: ahora le faltan ${falta}. Si no es lo que querías, anulá el despacho o producí más.`,
        );
      }
    }
  }

  await logActivity(tx, {
    userId: datos.userId,
    entity: "deliveries",
    entityId: despacho.id,
    action: "create",
    newValues: { number: despacho.number, customerId: despacho.customerId, renglones: armados.length },
  });

  return { despacho, avisos };
}

/** Lo que falta entregar de una factura, renglón por renglón. */
export async function porDespacharDeFactura(invoiceId: string) {
  const [factura] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!factura) return null;
  const lineas = await db
    .select({
      id: invoiceLines.id,
      catalogItemId: invoiceLines.catalogItemId,
      salesOrderLineId: invoiceLines.salesOrderLineId,
      description: invoiceLines.description,
      quantity: invoiceLines.quantity,
      blockTypeId: catalogItems.blockTypeId,
    })
    .from(invoiceLines)
    .leftJoin(catalogItems, eq(catalogItems.id, invoiceLines.catalogItemId))
    .where(eq(invoiceLines.invoiceId, invoiceId))
    .orderBy(invoiceLines.displayOrder);
  const entregado = await entregadoPorRenglonFactura(db, lineas.map((l) => l.id));
  const renglones = lineas.map((l) => ({
    ...l,
    entregado: entregado.get(l.id) ?? 0,
    falta: l.quantity - (entregado.get(l.id) ?? 0),
  }));
  return {
    factura: {
      id: factura.id,
      number: factura.number,
      kind: factura.kind,
      status: factura.status,
      customerId: factura.customerId,
      salesOrderId: factura.salesOrderId,
    },
    renglones,
    faltaAlgo: renglones.some((r) => r.falta > 0),
  };
}

export async function despachosRoutes(app: FastifyInstance) {
  /** La lista. Sin firmas ni fotos: se leen al abrir uno, no al listarlos. */
  app.get("/despachos", async (req) => {
    const { customerId, invoiceId, salesOrderId, estado } = req.query as {
      customerId?: string;
      invoiceId?: string;
      salesOrderId?: string;
      estado?: string;
    };
    const filtros = [isNull(deliveries.deletedAt)];
    if (customerId) filtros.push(eq(deliveries.customerId, customerId));
    if (invoiceId) filtros.push(eq(deliveries.invoiceId, invoiceId));
    if (salesOrderId) filtros.push(eq(deliveries.salesOrderId, salesOrderId));
    if (estado === "entregado" || estado === "anulado") filtros.push(eq(deliveries.status, estado));

    const filas = await db
      .select({
        id: deliveries.id,
        number: deliveries.number,
        customerId: deliveries.customerId,
        customerName: deliveries.customerName,
        status: deliveries.status,
        deliveredAt: deliveries.deliveredAt,
        receivedByName: deliveries.receivedByName,
        driverName: deliveries.driverName,
        vehiclePlate: deliveries.vehiclePlate,
        invoiceId: deliveries.invoiceId,
        salesOrderId: deliveries.salesOrderId,
        annulReason: deliveries.annulReason,
        facturaNumero: invoices.number,
        facturaTipo: invoices.kind,
        pedidoNumero: salesOrders.number,
        // Que exista firma importa en la lista; la firma en si, no.
        tieneFirma: sql<boolean>`(${deliveries.signature} is not null)`,
      })
      .from(deliveries)
      .leftJoin(invoices, eq(invoices.id, deliveries.invoiceId))
      .leftJoin(salesOrders, eq(salesOrders.id, deliveries.salesOrderId))
      .where(and(...filtros))
      .orderBy(desc(deliveries.number))
      .limit(300);

    const ids = filas.map((f) => f.id);
    const conteos = ids.length
      ? await db
          .select({
            deliveryId: deliveryLines.deliveryId,
            bloques: sql<number>`coalesce(sum(${deliveryLines.quantity}), 0)::int`,
          })
          .from(deliveryLines)
          .where(and(inArray(deliveryLines.deliveryId, ids), isNull(deliveryLines.deletedAt)))
          .groupBy(deliveryLines.deliveryId)
      : [];
    const fotos = ids.length
      ? await db
          .select({
            deliveryId: deliveryPhotos.deliveryId,
            cuantas: sql<number>`count(*)::int`,
          })
          .from(deliveryPhotos)
          .where(inArray(deliveryPhotos.deliveryId, ids))
          .groupBy(deliveryPhotos.deliveryId)
      : [];
    const porId = new Map(conteos.map((c) => [c.deliveryId, Number(c.bloques) || 0]));
    const fotosPorId = new Map(fotos.map((f) => [f.deliveryId, Number(f.cuantas) || 0]));

    return filas.map((f) => ({
      ...f,
      bloques: porId.get(f.id) ?? 0,
      fotos: fotosPorId.get(f.id) ?? 0,
    }));
  });

  /** La ficha completa: renglones, firma y fotos. */
  app.get("/despachos/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [despacho] = await db.select().from(deliveries).where(eq(deliveries.id, id));
    if (!despacho) return reply.code(404).send({ error: "Ese despacho no existe." });

    const [renglones, fotos, factura, pedido] = await Promise.all([
      db
        .select()
        .from(deliveryLines)
        .where(and(eq(deliveryLines.deliveryId, id), isNull(deliveryLines.deletedAt)))
        .orderBy(deliveryLines.displayOrder),
      db.select().from(deliveryPhotos).where(eq(deliveryPhotos.deliveryId, id)),
      despacho.invoiceId
        ? db.select().from(invoices).where(eq(invoices.id, despacho.invoiceId))
        : Promise.resolve([]),
      despacho.salesOrderId
        ? db.select().from(salesOrders).where(eq(salesOrders.id, despacho.salesOrderId))
        : Promise.resolve([]),
    ]);

    return {
      ...despacho,
      renglones,
      fotos,
      factura: factura[0] ? { id: factura[0].id, number: factura[0].number, kind: factura[0].kind, status: factura[0].status } : null,
      pedido: pedido[0] ? { id: pedido[0].id, number: pedido[0].number, status: pedido[0].status } : null,
    };
  });

  /** Qué falta entregar de una factura. */
  app.get("/invoices/:id/por-despachar", async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await porDespacharDeFactura(id);
    if (!r) return reply.code(404).send({ error: "Esa factura no existe." });
    return r;
  });

  /** Entregar. */
  app.post("/despachos", { bodyLimit: TOPE_CUERPO }, async (req, reply) => {
    const body = despachoSchema.parse(req.body);

    // Todo lo que se puede preguntar antes de abrir la transaccion, se pregunta
    // antes: en modo local la base es de una sola conexion y consultar adentro
    // de una transaccion abierta traba el proceso sin dar error.
    let customerId = body.customerId ?? null;
    let invoiceId = body.invoiceId ?? null;
    let salesOrderId = body.salesOrderId ?? null;

    if (invoiceId) {
      const [factura] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
      if (!factura) return reply.code(400).send({ error: "Esa factura no existe." });
      if (factura.status === "annulled") {
        return reply.code(409).send({
          error: `La factura N° ${factura.number} está anulada: no se puede entregar contra ella.`,
        });
      }
      customerId = customerId ?? factura.customerId;
      salesOrderId = salesOrderId ?? factura.salesOrderId;
    }
    if (salesOrderId) {
      const [pedido] = await db.select().from(salesOrders).where(eq(salesOrders.id, salesOrderId));
      if (!pedido) return reply.code(400).send({ error: "Ese pedido no existe." });
      customerId = customerId ?? pedido.customerId;
    }
    if (!customerId) return reply.code(400).send({ error: "Falta el cliente." });

    const [cliente] = await db.select().from(customers).where(eq(customers.id, customerId));
    if (!cliente) return reply.code(400).send({ error: "Ese cliente no existe." });

    const creado = await db.transaction((tx) =>
      crearDespacho(tx, {
        customerId: cliente.id,
        customerName: cliente.name,
        invoiceId,
        salesOrderId,
        deliveredAt: body.deliveredAt,
        receivedByName: body.receivedByName,
        receivedByDocument: body.receivedByDocument,
        address: body.address,
        driverName: body.driverName,
        vehiclePlate: body.vehiclePlate,
        notes: body.notes,
        signature: body.signature,
        fotos: body.fotos,
        lines: body.lines,
        userId: getUserId(req),
      }),
    );

    const avisos = [...creado.avisos];
    if (!body.signature) {
      avisos.push(
        "Este despacho quedó sin firma. Si mañana el cliente dice que llegaron menos, no hay con qué responderle.",
      );
    }
    return reply.code(201).send({ ...creado.despacho, avisos });
  });

  /**
   * Anular un despacho: los bloques vuelven al patio.
   *
   * No se edita, se anula, como todo lo que ya salio por la puerta. El numero
   * queda con su motivo y la serie sigue.
   */
  app.post("/despachos/:id/anular", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = anularSchema.parse(req.body);

    let devueltos = 0;
    const anulado = await db.transaction(async (tx) => {
      const [antes] = await tx.select().from(deliveries).where(eq(deliveries.id, id));
      if (!antes) return null;
      if (antes.status === "anulado") {
        throw Object.assign(new Error("Ese despacho ya estaba anulado."), { statusCode: 409 });
      }

      const [despues] = await tx
        .update(deliveries)
        .set({
          status: "anulado",
          annulledAt: new Date(),
          annulReason: body.reason.trim(),
          annulledBy: getUserId(req),
          updatedAt: new Date(),
        })
        .where(eq(deliveries.id, id))
        .returning();

      devueltos = await devolverAlPatio(tx, antes.id, antes.number, getUserId(req));

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "deliveries",
        entityId: id,
        action: "update",
        oldValues: { status: antes.status },
        newValues: { status: "anulado", reason: body.reason.trim() },
      });
      return despues;
    });

    if (!anulado) return reply.code(404).send({ error: "Ese despacho no existe." });
    return {
      ...anulado,
      avisos: [
        `Quedó anulado el despacho N° ${anulado.number}. El número no se reusa.`,
        ...(devueltos > 0 ? [`Los ${devueltos} bloques volvieron al patio.`] : []),
      ],
    };
  });
}

/**
 * Devuelve al patio lo que de verdad salio con un despacho.
 *
 * Lee los movimientos, no los renglones: si el producto se enlazo o desenlazo
 * de un tipo de bloque despues de la entrega, lo que importa es lo que salio.
 */
export async function devolverAlPatio(
  tx: Tx,
  deliveryId: string,
  numero: number,
  userId: string | null,
): Promise<number> {
  const salidas = await tx
    .select({
      blockTypeId: inventoryMoves.blockTypeId,
      cantidad: sql<number>`sum(${inventoryMoves.quantity})::int`,
    })
    .from(inventoryMoves)
    .where(and(eq(inventoryMoves.refType, "delivery"), eq(inventoryMoves.refId, deliveryId)))
    .groupBy(inventoryMoves.blockTypeId);

  let devueltos = 0;
  for (const s of salidas) {
    const neto = Number(s.cantidad) || 0;
    if (neto >= 0) continue;
    devueltos += -neto;
    await moverInventario(tx, {
      blockTypeId: s.blockTypeId,
      quantity: -neto,
      reason: "devolucion",
      refType: "delivery",
      refId: deliveryId,
      note: `Anulación del despacho N° ${numero}`,
      userId,
    });
  }
  return devueltos;
}
