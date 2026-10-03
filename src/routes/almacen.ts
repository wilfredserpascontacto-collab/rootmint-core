/**
 * El almacen de materia prima: lo que se compra, lo que llega y lo que hay.
 *
 * Cuatro ideas gobiernan este archivo, y las cuatro son la misma que ya
 * gobierna el patio de bloques:
 *
 *  1. La existencia no se guarda: es la suma de material_moves. Un numero
 *     guardado se desincroniza el dia que alguien lo escribe mal.
 *  2. Pedir una compra no mete nada al almacen. Lo mete la RECEPCION, que
 *     puede ser parcial y en varias fechas.
 *  3. Nada se borra. Un error se corrige con un movimiento en sentido
 *     contrario, o se anula con su motivo.
 *  4. Se avisa antes que impedir: una existencia negativa casi siempre
 *     significa que falto registrar una compra, no que falten materiales.
 *
 * Las cantidades van en milesimas: de la unidad de COMPRA en las compras
 * (12.5 bolsas = 12500) y de la unidad de DOSIFICACION en el almacen (kg,
 * litros...). La conversion se congela en cada linea de compra.
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  materialCountLines,
  materialCounts,
  materialMoves,
  materials,
  purchaseLines,
  purchaseReceiptLines,
  purchaseReceipts,
  purchases,
  suppliers,
  units,
} from "../db/schema-bloques.js";
import { logActivity } from "../lib/activity-log.js";
import { nextCorrelativo } from "../lib/counters.js";
import { getRol, getUserId } from "../lib/request-context.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const dinero = (c: number) =>
  `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cant = (m: number) => {
  const v = m / 1000;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, "");
};
const subtotal = (cantidadMilli: number, costoCents: number) =>
  Math.round((cantidadMilli * costoCents) / 1000);

const TOPE_CANTIDAD = 2_000_000_000;

// --- Existencia ------------------------------------------------------------

/** Cuanto hay de cada material, sumando movimientos. */
export async function existenciasMateriales(tx: Tx | typeof db) {
  const filas = await tx
    .select({
      materialId: materialMoves.materialId,
      cantidad: sql<number>`sum(${materialMoves.quantityMilli})::int`,
    })
    .from(materialMoves)
    .groupBy(materialMoves.materialId);
  return new Map(filas.map((f) => [f.materialId, Number(f.cantidad) || 0]));
}

export async function existenciaDeMaterial(tx: Tx | typeof db, materialId: string): Promise<number> {
  const [fila] = await tx
    .select({ cantidad: sql<number>`coalesce(sum(${materialMoves.quantityMilli}), 0)::int` })
    .from(materialMoves)
    .where(eq(materialMoves.materialId, materialId));
  return Number(fila?.cantidad) || 0;
}

/** Anota un movimiento de material. La unica forma de que el almacen cambie. */
export async function moverMaterial(
  tx: Tx,
  m: {
    materialId: string;
    quantityMilli: number;
    reason: "compra" | "consumo" | "ajuste" | "merma" | "devolucion";
    refType?: string;
    refId?: string;
    costCents?: number | null;
    note?: string;
    userId: string | null;
  },
) {
  if (m.quantityMilli === 0) return;
  await tx.insert(materialMoves).values({
    materialId: m.materialId,
    quantityMilli: m.quantityMilli,
    reason: m.reason,
    refType: m.refType ?? null,
    refId: m.refId ?? null,
    costCents: m.costCents ?? null,
    note: m.note ?? null,
    createdBy: m.userId,
  });
}

/**
 * Lo recibido de cada linea de compra, contando solo las recepciones vivas.
 * Una recepcion anulada no trajo nada.
 */
async function recibidoPorLinea(tx: Tx | typeof db, purchaseIds: string[]) {
  if (purchaseIds.length === 0) return new Map<string, number>();
  const filas = await tx
    .select({
      lineId: purchaseReceiptLines.purchaseLineId,
      cantidad: sql<number>`sum(${purchaseReceiptLines.quantityMilli})::int`,
    })
    .from(purchaseReceiptLines)
    .innerJoin(purchaseReceipts, eq(purchaseReceipts.id, purchaseReceiptLines.receiptId))
    .where(and(inArray(purchaseReceipts.purchaseId, purchaseIds), isNull(purchaseReceipts.annulledAt)))
    .groupBy(purchaseReceiptLines.purchaseLineId);
  return new Map(filas.map((f) => [f.lineId, Number(f.cantidad) || 0]));
}

type EstadoCompra = "pendiente" | "parcial" | "completa" | "cerrada" | "cancelada";

function estadoDeCompra(
  status: "abierta" | "cancelada",
  lineas: { quantityMilli: number; recibido: number }[],
): EstadoCompra {
  const algo = lineas.some((l) => l.recibido > 0);
  if (status === "cancelada") return algo ? "cerrada" : "cancelada";
  if (lineas.length > 0 && lineas.every((l) => l.recibido >= l.quantityMilli)) return "completa";
  return algo ? "parcial" : "pendiente";
}

// --- Entradas ----------------------------------------------------------------

const textoOpcional = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : null));

const proveedorCrear = z.object({
  name: z.string().trim().min(1, "El proveedor necesita un nombre.").max(160),
  nit: textoOpcional,
  nrc: textoOpcional,
  contactName: textoOpcional,
  phone: textoOpcional,
  email: z.union([z.literal(""), z.string().email("Eso no parece un correo.")]).optional().transform((v) => v || null),
  address: textoOpcional,
  notes: z.string().trim().max(2000).optional().transform((v) => (v ? v : null)),
});

const compraCrear = z.object({
  supplierId: z.string().uuid("Elegí el proveedor."),
  orderedOn: z.coerce.date().optional(),
  documentRef: textoOpcional,
  notes: z.string().trim().max(2000).optional().transform((v) => (v ? v : null)),
  lines: z
    .array(
      z.object({
        materialId: z.string().uuid("Elegí el material."),
        quantityMilli: z
          .number({ invalid_type_error: "La cantidad tiene que ser un número." })
          .int("La cantidad va en milésimas, sin decimales.")
          .positive("La cantidad tiene que ser mayor que cero.")
          .max(TOPE_CANTIDAD),
        unitCostCents: z.number().int().nonnegative().max(TOPE_CANTIDAD).optional(),
      }),
    )
    .min(1, "Una compra necesita al menos un material."),
});

const recepcionCrear = z.object({
  receivedOn: z.coerce.date().optional(),
  documentRef: textoOpcional,
  notes: z.string().trim().max(2000).optional().transform((v) => (v ? v : null)),
  lines: z
    .array(
      z.object({
        purchaseLineId: z.string().uuid(),
        quantityMilli: z
          .number({ invalid_type_error: "La cantidad tiene que ser un número." })
          .int()
          .positive("La cantidad recibida tiene que ser mayor que cero.")
          .max(TOPE_CANTIDAD),
        unitCostCents: z.number().int().nonnegative().max(TOPE_CANTIDAD).optional(),
      }),
    )
    .min(1, "Anotá al menos un material recibido."),
});

const motivoSchema = z.object({
  reason: z.string().trim().min(3, "Decí por qué: dentro de seis meses nadie va a recordarlo."),
});

const ajusteSchema = z.object({
  materialId: z.string().uuid(),
  quantityMilli: z.number().int().refine((n) => n !== 0, "Un ajuste de cero no ajusta nada.").refine(
    (n) => Math.abs(n) <= TOPE_CANTIDAD,
    "Esa cantidad es demasiado grande: revisá los ceros.",
  ),
  reason: z.enum(["ajuste", "merma"]).default("ajuste"),
  note: z.string().trim().min(3, "Decí por qué se ajusta: un número que cambió sin explicación no sirve de nada."),
});

export async function almacenRoutes(app: FastifyInstance) {
  // --- Proveedores -----------------------------------------------------------

  app.get("/bloques/proveedores", async () =>
    db.select().from(suppliers).where(isNull(suppliers.deletedAt)).orderBy(suppliers.name),
  );

  app.post("/bloques/proveedores", async (req, reply) => {
    const body = proveedorCrear.parse(req.body);
    const creado = await db.transaction(async (tx) => {
      const [fila] = await tx.insert(suppliers).values({ ...body, createdBy: getUserId(req) }).returning();
      if (!fila) throw new Error("No se pudo guardar el proveedor.");
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "suppliers",
        entityId: fila.id,
        action: "create",
        newValues: fila,
      });
      return fila;
    });
    return reply.code(201).send(creado);
  });

  app.patch("/bloques/proveedores/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = proveedorCrear.partial().extend({ active: z.boolean().optional() }).parse(req.body);
    const actualizado = await db.transaction(async (tx) => {
      const [antes] = await tx.select().from(suppliers).where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt)));
      if (!antes) return null;
      const [despues] = await tx
        .update(suppliers)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(suppliers.id, id))
        .returning();
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "suppliers",
        entityId: id,
        action: "update",
        oldValues: antes,
        newValues: despues,
      });
      return despues;
    });
    if (!actualizado) return reply.code(404).send({ error: "Ese proveedor no existe." });
    return actualizado;
  });

  // --- Existencias de materiales --------------------------------------------

  /**
   * Cuanto hay de cada material, cuanto esta por llegar y a cuanto salio la
   * ultima compra.
   *
   * El valor es «a ultimo costo»: la cantidad por lo que costo la ultima vez.
   * No es un metodo de valoracion contable (promedio, PEPS): ese lo define
   * quien lleva la contabilidad. Un material que nunca se compro por el
   * sistema queda sin costo, y su valor sin calcular: no se inventa.
   */
  app.get("/bloques/almacen/materiales", async () => {
    const mats = await db
      .select({
        id: materials.id,
        code: materials.code,
        name: materials.name,
        category: materials.category,
        minStockMilli: materials.minStockMilli,
        purchaseUnit: materials.purchaseUnit,
        purchasePriceCents: materials.purchasePriceCents,
        contentPerPurchaseMilli: materials.contentPerPurchaseMilli,
        unidad: units.abbreviation,
      })
      .from(materials)
      .leftJoin(units, eq(materials.dosingUnitId, units.id))
      .where(and(isNull(materials.deletedAt), eq(materials.active, true)))
      .orderBy(materials.name);

    const stock = await existenciasMateriales(db);

    // Ultimo costo por unidad de dosificacion, de la recepcion viva mas reciente.
    const recibidas = await db
      .select({
        materialId: purchaseReceiptLines.materialId,
        unitCostCents: purchaseReceiptLines.unitCostCents,
        quantityMilli: purchaseReceiptLines.quantityMilli,
        dosingQuantityMilli: purchaseReceiptLines.dosingQuantityMilli,
        costCents: purchaseReceiptLines.costCents,
        receivedOn: purchaseReceipts.receivedOn,
      })
      .from(purchaseReceiptLines)
      .innerJoin(purchaseReceipts, eq(purchaseReceipts.id, purchaseReceiptLines.receiptId))
      .where(isNull(purchaseReceipts.annulledAt))
      .orderBy(desc(purchaseReceipts.receivedOn), desc(purchaseReceiptLines.createdAt));
    const ultimo = new Map<string, (typeof recibidas)[number]>();
    for (const r of recibidas) if (!ultimo.has(r.materialId)) ultimo.set(r.materialId, r);

    // Lo que esta pedido y aun no llega, en unidades de dosificacion.
    const abiertas = await db
      .select({ id: purchases.id })
      .from(purchases)
      .where(and(eq(purchases.status, "abierta"), isNull(purchases.deletedAt)));
    const lineasAbiertas = abiertas.length
      ? await db
          .select()
          .from(purchaseLines)
          .where(inArray(purchaseLines.purchaseId, abiertas.map((a) => a.id)))
      : [];
    const recibido = await recibidoPorLinea(db, abiertas.map((a) => a.id));
    const porRecibir = new Map<string, number>();
    for (const l of lineasAbiertas) {
      const falta = Math.max(0, l.quantityMilli - (recibido.get(l.id) ?? 0));
      porRecibir.set(
        l.materialId,
        (porRecibir.get(l.materialId) ?? 0) + Math.round((falta * l.contentPerPurchaseMilli) / 1000),
      );
    }

    const filas = mats.map((m) => {
      const existencia = stock.get(m.id) ?? 0;
      const u = ultimo.get(m.id);
      // Centavos por UNIDAD DE DOSIFICACION (puede ser menos de un centavo).
      const costoUnidad =
        u && u.dosingQuantityMilli > 0 ? (u.costCents * 1000) / u.dosingQuantityMilli : null;
      return {
        materialId: m.id,
        code: m.code,
        name: m.name,
        category: m.category,
        unidad: m.unidad ?? "u",
        existenciaMilli: existencia,
        minStockMilli: m.minStockMilli,
        bajoMinimo: m.minStockMilli !== null && existencia < m.minStockMilli,
        porRecibirMilli: porRecibir.get(m.id) ?? 0,
        ultimoCostoUnidadCents: costoUnidad,
        ultimaCompraEn: u?.receivedOn ?? null,
        valorCents:
          costoUnidad !== null && existencia > 0 ? Math.round((existencia / 1000) * costoUnidad) : null,
      };
    });

    return {
      materiales: filas,
      totales: {
        valorCents: filas.reduce((a, f) => a + (f.valorCents ?? 0), 0),
        sinCosto: filas.filter((f) => f.ultimoCostoUnidadCents === null && f.existenciaMilli > 0).length,
        bajoMinimo: filas.filter((f) => f.bajoMinimo).length,
        negativos: filas.filter((f) => f.existenciaMilli < 0).length,
      },
    };
  });

  /** De donde salio y adonde se fue cada kilo de un material. */
  app.get("/bloques/almacen/materiales/:id/movimientos", async (req) => {
    const { id } = req.params as { id: string };
    return db
      .select()
      .from(materialMoves)
      .where(eq(materialMoves.materialId, id))
      .orderBy(desc(materialMoves.notedAt), desc(materialMoves.createdAt))
      .limit(200);
  });

  /** El minimo por debajo del cual hay que comprar. Vacio lo quita: nulo no es cero. */
  app.patch("/bloques/almacen/materiales/:id/minimo", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { minStockMilli } = z
      .object({ minStockMilli: z.number().int().nonnegative().max(TOPE_CANTIDAD).nullable() })
      .parse(req.body);
    const [m] = await db
      .update(materials)
      .set({ minStockMilli, updatedAt: new Date() })
      .where(and(eq(materials.id, id), isNull(materials.deletedAt)))
      .returning();
    if (!m) return reply.code(404).send({ error: "Ese material no existe." });
    return { materialId: id, minStockMilli: m.minStockMilli };
  });

  /** Corregir a mano: una merma, un derrame, un error de conteo. Siempre con motivo. */
  app.post("/bloques/almacen/ajuste", async (req, reply) => {
    const body = ajusteSchema.parse(req.body);
    if (body.reason === "merma" && body.quantityMilli > 0) {
      return reply.code(400).send({ error: "Una merma es una pérdida: la cantidad tiene que ser negativa." });
    }
    const [mat] = await db
      .select({ id: materials.id, name: materials.name, unidad: units.abbreviation })
      .from(materials)
      .leftJoin(units, eq(materials.dosingUnitId, units.id))
      .where(and(eq(materials.id, body.materialId), isNull(materials.deletedAt)));
    if (!mat) return reply.code(400).send({ error: "Ese material no existe." });

    const antes = await existenciaDeMaterial(db, body.materialId);
    await db.transaction(async (tx) => {
      await moverMaterial(tx, {
        materialId: body.materialId,
        quantityMilli: body.quantityMilli,
        reason: body.reason,
        note: body.note,
        userId: getUserId(req),
      });
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "material_moves",
        entityId: body.materialId,
        action: "create",
        newValues: { quantityMilli: body.quantityMilli, reason: body.reason, note: body.note },
      });
    });
    const despues = antes + body.quantityMilli;
    return {
      materialId: body.materialId,
      existenciaMilli: despues,
      avisos:
        despues < 0
          ? [
              `La existencia de «${mat.name}» quedó en ${cant(despues)} ${mat.unidad ?? ""}. Un negativo casi siempre significa que faltó registrar una compra o un conteo, no que falte material.`.replace(/ \./, "."),
            ]
          : [],
    };
  });

  // --- Compras ---------------------------------------------------------------

  app.get("/bloques/compras", async () => {
    const compras = await db
      .select({
        id: purchases.id,
        number: purchases.number,
        supplierId: purchases.supplierId,
        supplierName: suppliers.name,
        orderedOn: purchases.orderedOn,
        documentRef: purchases.documentRef,
        status: purchases.status,
      })
      .from(purchases)
      .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
      .where(isNull(purchases.deletedAt))
      .orderBy(desc(purchases.orderedOn), desc(purchases.number));
    const ids = compras.map((c) => c.id);
    const lineas = ids.length
      ? await db.select().from(purchaseLines).where(inArray(purchaseLines.purchaseId, ids))
      : [];
    const recibido = await recibidoPorLinea(db, ids);
    return compras.map((c) => {
      const propias = lineas
        .filter((l) => l.purchaseId === c.id)
        .map((l) => ({ ...l, recibido: recibido.get(l.id) ?? 0 }));
      return {
        ...c,
        estado: estadoDeCompra(c.status, propias),
        renglones: propias.length,
        totalCents: propias.reduce((a, l) => a + subtotal(l.quantityMilli, l.unitCostCents), 0),
        recibidoCents: propias.reduce((a, l) => a + subtotal(l.recibido, l.unitCostCents), 0),
      };
    });
  });

  async function detalleDeCompra(id: string) {
    const [compra] = await db
      .select()
      .from(purchases)
      .where(and(eq(purchases.id, id), isNull(purchases.deletedAt)));
    if (!compra) return null;
    const [prov] = await db.select().from(suppliers).where(eq(suppliers.id, compra.supplierId));
    const lineas = await db
      .select()
      .from(purchaseLines)
      .where(eq(purchaseLines.purchaseId, id))
      .orderBy(purchaseLines.displayOrder);
    const recibido = await recibidoPorLinea(db, [id]);
    const recepciones = await db
      .select()
      .from(purchaseReceipts)
      .where(eq(purchaseReceipts.purchaseId, id))
      .orderBy(purchaseReceipts.receivedOn, purchaseReceipts.number);
    const lineasRecepcion = recepciones.length
      ? await db
          .select()
          .from(purchaseReceiptLines)
          .where(inArray(purchaseReceiptLines.receiptId, recepciones.map((r) => r.id)))
      : [];
    const descripcion = new Map(lineas.map((l) => [l.id, l]));

    const renglones = lineas.map((l) => {
      const rec = recibido.get(l.id) ?? 0;
      return {
        id: l.id,
        materialId: l.materialId,
        description: l.description,
        purchaseUnit: l.purchaseUnit,
        contentPerPurchaseMilli: l.contentPerPurchaseMilli,
        quantityMilli: l.quantityMilli,
        unitCostCents: l.unitCostCents,
        recibidoMilli: rec,
        pendienteMilli: Math.max(0, l.quantityMilli - rec),
        subtotalCents: subtotal(l.quantityMilli, l.unitCostCents),
      };
    });

    return {
      ...compra,
      supplier: prov ?? null,
      estado: estadoDeCompra(
        compra.status,
        lineas.map((l) => ({ quantityMilli: l.quantityMilli, recibido: recibido.get(l.id) ?? 0 })),
      ),
      lines: renglones,
      totalCents: renglones.reduce((a, l) => a + l.subtotalCents, 0),
      recibidoCents: lineas.reduce((a, l) => a + subtotal(recibido.get(l.id) ?? 0, l.unitCostCents), 0),
      receipts: recepciones.map((r) => {
        const propias = lineasRecepcion.filter((l) => l.receiptId === r.id);
        return {
          ...r,
          totalCents: propias.reduce((a, l) => a + l.costCents, 0),
          lines: propias.map((l) => ({
            purchaseLineId: l.purchaseLineId,
            description: descripcion.get(l.purchaseLineId)?.description ?? "Material",
            purchaseUnit: descripcion.get(l.purchaseLineId)?.purchaseUnit ?? "",
            quantityMilli: l.quantityMilli,
            dosingQuantityMilli: l.dosingQuantityMilli,
            unitCostCents: l.unitCostCents,
            costCents: l.costCents,
          })),
        };
      }),
    };
  }

  app.get("/bloques/compras/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = await detalleDeCompra(id);
    if (!d) return reply.code(404).send({ error: "Esa compra no existe." });
    return d;
  });

  app.post("/bloques/compras", async (req, reply) => {
    const body = compraCrear.parse(req.body);

    const id = await db.transaction(async (tx) => {
      const [prov] = await tx.select().from(suppliers).where(and(eq(suppliers.id, body.supplierId), isNull(suppliers.deletedAt)));
      if (!prov) throw Object.assign(new Error("Ese proveedor no existe."), { statusCode: 400 });
      if (!prov.active) {
        throw Object.assign(new Error(`«${prov.name}» está marcado como inactivo. Reactivalo para comprarle.`), {
          statusCode: 409,
        });
      }

      const ids = [...new Set(body.lines.map((l) => l.materialId))];
      const mats = await tx
        .select()
        .from(materials)
        .where(and(inArray(materials.id, ids), isNull(materials.deletedAt)));
      const porId = new Map(mats.map((m) => [m.id, m]));
      for (const l of body.lines) {
        if (!porId.has(l.materialId)) {
          throw Object.assign(new Error("Uno de los materiales ya no existe en el catálogo."), { statusCode: 400 });
        }
      }

      const number = await nextCorrelativo(tx, "purchase");
      const [compra] = await tx
        .insert(purchases)
        .values({
          number,
          supplierId: body.supplierId,
          orderedOn: body.orderedOn ?? new Date(),
          documentRef: body.documentRef,
          notes: body.notes,
          createdBy: getUserId(req),
        })
        .returning();
      if (!compra) throw new Error("No se pudo crear la compra.");

      await tx.insert(purchaseLines).values(
        body.lines.map((l, i) => {
          const m = porId.get(l.materialId)!;
          return {
            purchaseId: compra.id,
            materialId: m.id,
            description: m.name,
            purchaseUnit: m.purchaseUnit,
            contentPerPurchaseMilli: Math.max(1, m.contentPerPurchaseMilli),
            quantityMilli: l.quantityMilli,
            unitCostCents: l.unitCostCents ?? m.purchasePriceCents,
            displayOrder: i,
          };
        }),
      );

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "purchases",
        entityId: compra.id,
        action: "create",
        newValues: { number, supplierId: body.supplierId, renglones: body.lines.length },
      });
      return compra.id;
    });

    const d = await detalleDeCompra(id);
    const sinPrecio = d?.lines.filter((l) => l.unitCostCents === 0) ?? [];
    return reply.code(201).send({
      ...d,
      avisos: sinPrecio.length
        ? [
            `${sinPrecio.map((l) => `«${l.description}»`).join(", ")} ${sinPrecio.length === 1 ? "no tiene" : "no tienen"} precio. Una compra a cero hace que el costo del material quede sin saberse: ponele lo que costó, o corregilo al recibirla.`,
          ]
        : [],
    });
  });

  /**
   * Dejar de esperar una compra. Si ya llego algo, lo recibido se queda: lo
   * que se cancela es lo que falta. Nada de lo ya recibido se toca; para
   * deshacer una llegada se anula la recepcion.
   */
  app.post("/bloques/compras/:id/cancelar", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = motivoSchema.parse(req.body);
    const resultado = await db.transaction(async (tx) => {
      const [antes] = await tx.select().from(purchases).where(and(eq(purchases.id, id), isNull(purchases.deletedAt)));
      if (!antes) return null;
      if (antes.status === "cancelada") {
        throw Object.assign(new Error("Esa compra ya estaba cancelada."), { statusCode: 409 });
      }
      const [despues] = await tx
        .update(purchases)
        .set({ status: "cancelada", cancelledAt: new Date(), cancelReason: body.reason, updatedAt: new Date() })
        .where(eq(purchases.id, id))
        .returning();
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "purchases",
        entityId: id,
        action: "update",
        oldValues: { status: antes.status },
        newValues: { status: "cancelada", reason: body.reason },
      });
      return despues;
    });
    if (!resultado) return reply.code(404).send({ error: "Esa compra no existe." });
    const d = await detalleDeCompra(id);
    return {
      ...d,
      avisos:
        d && d.recibidoCents > 0
          ? ["Lo que ya había llegado se queda en el almacén. Se canceló solo lo que faltaba."]
          : [],
    };
  });

  /** Registrar una llegada de mercaderia, completa o parcial. Esto es lo que mete material al almacen. */
  app.post("/bloques/compras/:id/recepciones", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = recepcionCrear.parse(req.body);

    const resultado = await db.transaction(async (tx) => {
      const [compra] = await tx.select().from(purchases).where(and(eq(purchases.id, id), isNull(purchases.deletedAt)));
      if (!compra) throw Object.assign(new Error("Esa compra no existe."), { statusCode: 404 });
      if (compra.status === "cancelada") {
        throw Object.assign(new Error("Esa compra está cancelada: ya no se le pueden anotar recepciones."), {
          statusCode: 409,
        });
      }

      const lineas = await tx.select().from(purchaseLines).where(eq(purchaseLines.purchaseId, id));
      const porId = new Map(lineas.map((l) => [l.id, l]));
      for (const l of body.lines) {
        if (!porId.has(l.purchaseLineId)) {
          throw Object.assign(new Error("Uno de los renglones no pertenece a esta compra."), { statusCode: 400 });
        }
      }
      const yaRecibido = await recibidoPorLinea(tx, [id]);

      const number = await nextCorrelativo(tx, "purchase_receipt");
      const [recepcion] = await tx
        .insert(purchaseReceipts)
        .values({
          number,
          purchaseId: id,
          receivedOn: body.receivedOn ?? new Date(),
          documentRef: body.documentRef,
          notes: body.notes,
          createdBy: getUserId(req),
        })
        .returning();
      if (!recepcion) throw new Error("No se pudo anotar la recepción.");

      const avisos: string[] = [];
      const acumulado = new Map<string, number>();
      for (const l of body.lines) {
        const linea = porId.get(l.purchaseLineId)!;
        const costo = l.unitCostCents ?? linea.unitCostCents;
        const dosis = Math.round((l.quantityMilli * linea.contentPerPurchaseMilli) / 1000);
        const costoTotal = subtotal(l.quantityMilli, costo);

        await tx.insert(purchaseReceiptLines).values({
          receiptId: recepcion.id,
          purchaseLineId: linea.id,
          materialId: linea.materialId,
          quantityMilli: l.quantityMilli,
          dosingQuantityMilli: dosis,
          unitCostCents: costo,
          costCents: costoTotal,
        });
        await moverMaterial(tx, {
          materialId: linea.materialId,
          quantityMilli: dosis,
          reason: "compra",
          refType: "purchase_receipt",
          refId: recepcion.id,
          costCents: costoTotal,
          note: `Compra N° ${compra.number}, recepción N° ${number}`,
          userId: getUserId(req),
        });

        const total = (acumulado.get(linea.id) ?? yaRecibido.get(linea.id) ?? 0) + l.quantityMilli;
        acumulado.set(linea.id, total);
        if (costo !== linea.unitCostCents) {
          avisos.push(
            `«${linea.description}» se pidió a ${dinero(linea.unitCostCents)} por ${linea.purchaseUnit} y llegó a ${dinero(costo)}. Quedó anotado el precio real.`,
          );
        }
      }
      for (const [lineaId, total] of acumulado) {
        const linea = porId.get(lineaId)!;
        if (total > linea.quantityMilli) {
          avisos.push(
            `De «${linea.description}» se pidieron ${cant(linea.quantityMilli)} ${linea.purchaseUnit} y ya van ${cant(total)}: llegó de más.`,
          );
        }
      }

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "purchase_receipts",
        entityId: recepcion.id,
        action: "create",
        newValues: { number, purchaseId: id, renglones: body.lines.length },
      });
      return { avisos };
    });

    const d = await detalleDeCompra(id);
    if (d?.estado === "completa") resultado.avisos.push("Con esta recepción la compra quedó completa.");
    return reply.code(201).send({ ...d, avisos: resultado.avisos });
  });

  /**
   * Deshacer una llegada: se registra la salida contraria y la recepcion
   * queda anulada con su motivo. Si el material ya se uso, la existencia puede
   * quedar negativa: se avisa, no se impide.
   */
  app.post("/bloques/recepciones/:id/anular", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = motivoSchema.parse(req.body);

    const resultado = await db.transaction(async (tx) => {
      const [antes] = await tx.select().from(purchaseReceipts).where(eq(purchaseReceipts.id, id));
      if (!antes) return null;
      if (antes.annulledAt) {
        throw Object.assign(new Error("Esa recepción ya estaba anulada."), { statusCode: 409 });
      }
      await tx
        .update(purchaseReceipts)
        .set({ annulledAt: new Date(), annulReason: body.reason, annulledBy: getUserId(req), updatedAt: new Date() })
        .where(eq(purchaseReceipts.id, id));

      const lineas = await tx.select().from(purchaseReceiptLines).where(eq(purchaseReceiptLines.receiptId, id));
      const nombres = new Map(
        (
          await tx
            .select({ id: materials.id, name: materials.name })
            .from(materials)
            .where(inArray(materials.id, lineas.map((l) => l.materialId)))
        ).map((m) => [m.id, m.name]),
      );
      const avisos: string[] = [];
      for (const l of lineas) {
        const antesDe = await existenciaDeMaterial(tx, l.materialId);
        await moverMaterial(tx, {
          materialId: l.materialId,
          quantityMilli: -l.dosingQuantityMilli,
          reason: "compra",
          refType: "purchase_receipt",
          refId: id,
          costCents: -l.costCents,
          note: `Anulación de la recepción N° ${antes.number}`,
          userId: getUserId(req),
        });
        if (antesDe - l.dosingQuantityMilli < 0) {
          avisos.push(
            `La existencia de «${nombres.get(l.materialId) ?? "un material"}» quedó en ${cant(antesDe - l.dosingQuantityMilli)}: parte de lo que llegó ya se había usado.`,
          );
        }
      }
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "purchase_receipts",
        entityId: id,
        action: "update",
        oldValues: { annulledAt: null },
        newValues: { reason: body.reason },
      });
      return { purchaseId: antes.purchaseId, avisos, numero: antes.number };
    });
    if (!resultado) return reply.code(404).send({ error: "Esa recepción no existe." });
    const d = await detalleDeCompra(resultado.purchaseId);
    return {
      ...d,
      avisos: [`Quedó anulada la recepción N° ${resultado.numero}. Lo que había entrado salió del almacén.`, ...resultado.avisos],
    };
  });

  // --- Conteo fisico -----------------------------------------------------------

  async function detalleDeConteo(id: string) {
    const [conteo] = await db
      .select()
      .from(materialCounts)
      .where(and(eq(materialCounts.id, id), isNull(materialCounts.deletedAt)));
    if (!conteo) return null;
    const lineas = await db
      .select()
      .from(materialCountLines)
      .where(eq(materialCountLines.countId, id))
      .orderBy(materialCountLines.description);
    const hoy = await existenciasMateriales(db);
    return {
      ...conteo,
      lines: lineas.map((l) => ({
        id: l.id,
        materialId: l.materialId,
        description: l.description,
        unitAbbreviation: l.unitAbbreviation,
        expectedMilli: l.expectedMilli,
        countedMilli: l.countedMilli,
        note: l.note,
        diferenciaMilli: l.countedMilli === null ? null : l.countedMilli - l.expectedMilli,
        // Lo que entro o salio desde que se abrio el conteo. Si no es cero, el
        // sistema avisa: contar con la bodega en movimiento deja huecos.
        movimientoDesdeElCorteMilli: (hoy.get(l.materialId) ?? 0) - l.expectedMilli,
      })),
    };
  }

  app.get("/bloques/conteos", async () => {
    const conteos = await db
      .select()
      .from(materialCounts)
      .where(isNull(materialCounts.deletedAt))
      .orderBy(desc(materialCounts.number));
    const lineas = conteos.length
      ? await db
          .select({ countId: materialCountLines.countId, countedMilli: materialCountLines.countedMilli })
          .from(materialCountLines)
          .where(inArray(materialCountLines.countId, conteos.map((c) => c.id)))
      : [];
    return conteos.map((c) => {
      const propias = lineas.filter((l) => l.countId === c.id);
      return {
        ...c,
        renglones: propias.length,
        contados: propias.filter((l) => l.countedMilli !== null).length,
      };
    });
  });

  app.get("/bloques/conteos/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = await detalleDeConteo(id);
    if (!d) return reply.code(404).send({ error: "Ese conteo no existe." });
    return d;
  });

  /** Abrir un conteo: congela lo que el sistema cree que hay de cada material. */
  app.post("/bloques/conteos", async (req, reply) => {
    const body = z.object({ notes: z.string().trim().max(2000).optional() }).parse(req.body ?? {});
    const id = await db.transaction(async (tx) => {
      const [abierto] = await tx
        .select()
        .from(materialCounts)
        .where(and(eq(materialCounts.status, "abierto"), isNull(materialCounts.deletedAt)));
      if (abierto) {
        throw Object.assign(
          new Error(`Ya hay un conteo abierto (N° ${abierto.number}). Terminalo o cancelalo antes de abrir otro.`),
          { statusCode: 409 },
        );
      }
      const mats = await tx
        .select({ id: materials.id, name: materials.name, unidad: units.abbreviation })
        .from(materials)
        .leftJoin(units, eq(materials.dosingUnitId, units.id))
        .where(and(isNull(materials.deletedAt), eq(materials.active, true)));
      if (mats.length === 0) {
        throw Object.assign(new Error("No hay materiales en el catálogo para contar."), { statusCode: 409 });
      }
      const stock = await existenciasMateriales(tx);
      const number = await nextCorrelativo(tx, "material_count");
      const [conteo] = await tx
        .insert(materialCounts)
        .values({ number, notes: body.notes || null, createdBy: getUserId(req) })
        .returning();
      if (!conteo) throw new Error("No se pudo abrir el conteo.");
      await tx.insert(materialCountLines).values(
        mats.map((m) => ({
          countId: conteo.id,
          materialId: m.id,
          description: m.name,
          unitAbbreviation: m.unidad ?? "u",
          expectedMilli: stock.get(m.id) ?? 0,
        })),
      );
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "material_counts",
        entityId: conteo.id,
        action: "create",
        newValues: { number, materiales: mats.length },
      });
      return conteo.id;
    });
    return reply.code(201).send(await detalleDeConteo(id));
  });

  /** Guardar lo contado. Se puede ir llenando de a poco; nulo borra un conteo. */
  app.patch("/bloques/conteos/:id/lineas", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        lines: z
          .array(
            z.object({
              id: z.string().uuid(),
              countedMilli: z
                .number({ invalid_type_error: "Lo contado tiene que ser un número." })
                .int()
                .nonnegative("Lo contado no puede ser negativo.")
                .max(TOPE_CANTIDAD)
                .nullable(),
              note: z.string().trim().max(500).optional(),
            }),
          )
          .min(1),
      })
      .parse(req.body);

    const conteo = await db.transaction(async (tx) => {
      const [c] = await tx.select().from(materialCounts).where(eq(materialCounts.id, id));
      if (!c) return null;
      if (c.status !== "abierto") {
        throw Object.assign(new Error("Ese conteo ya está cerrado: no se le pueden cambiar las cantidades."), {
          statusCode: 409,
        });
      }
      for (const l of body.lines) {
        const [fila] = await tx
          .update(materialCountLines)
          .set({
            countedMilli: l.countedMilli,
            ...(l.note !== undefined ? { note: l.note || null } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(materialCountLines.id, l.id), eq(materialCountLines.countId, id)))
          .returning({ id: materialCountLines.id });
        if (!fila) throw Object.assign(new Error("Uno de los renglones no pertenece a este conteo."), { statusCode: 400 });
      }
      return c;
    });
    if (!conteo) return reply.code(404).send({ error: "Ese conteo no existe." });
    return detalleDeConteo(id);
  });

  /**
   * Aprobar: lo contado pasa a ser lo que hay. Solo la duena, porque cambia lo
   * que dice el almacen. Registra la DIFERENCIA contra lo congelado, asi que
   * lo que haya entrado o salido mientras se contaba no se pisa.
   */
  app.post("/bloques/conteos/:id/aprobar", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (getRol(req) !== "owner") {
      return reply.code(403).send({
        error: "Solo la dueña aprueba un conteo, porque cambia lo que dice el almacén.",
      });
    }

    const resultado = await db.transaction(async (tx) => {
      const [c] = await tx.select().from(materialCounts).where(eq(materialCounts.id, id));
      if (!c) return null;
      if (c.status !== "abierto") {
        throw Object.assign(new Error(`Ese conteo ya está ${c.status === "aprobado" ? "aprobado" : "cancelado"}.`), {
          statusCode: 409,
        });
      }
      const lineas = await tx.select().from(materialCountLines).where(eq(materialCountLines.countId, id));
      const contadas = lineas.filter((l) => l.countedMilli !== null);
      if (contadas.length === 0) {
        throw Object.assign(new Error("No se ha contado ningún material: no hay nada que aprobar."), {
          statusCode: 409,
        });
      }

      const cambios: { description: string; unitAbbreviation: string; diferenciaMilli: number }[] = [];
      for (const l of contadas) {
        const dif = (l.countedMilli ?? 0) - l.expectedMilli;
        if (dif === 0) continue;
        await moverMaterial(tx, {
          materialId: l.materialId,
          quantityMilli: dif,
          reason: "ajuste",
          refType: "material_count",
          refId: id,
          note: `Conteo físico N° ${c.number}: de ${cant(l.expectedMilli)} a ${cant(l.countedMilli ?? 0)}`,
          userId: getUserId(req),
        });
        cambios.push({ description: l.description, unitAbbreviation: l.unitAbbreviation, diferenciaMilli: dif });
      }

      await tx
        .update(materialCounts)
        .set({ status: "aprobado", approvedAt: new Date(), approvedBy: getUserId(req), updatedAt: new Date() })
        .where(eq(materialCounts.id, id));
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "material_counts",
        entityId: id,
        action: "update",
        oldValues: { status: "abierto" },
        newValues: { status: "aprobado", ajustes: cambios.length },
      });
      return { numero: c.number, cambios, sinContar: lineas.length - contadas.length };
    });
    if (!resultado) return reply.code(404).send({ error: "Ese conteo no existe." });

    const avisos: string[] = [
      resultado.cambios.length === 0
        ? `Conteo N° ${resultado.numero} aprobado: lo contado coincide con lo que decía el sistema.`
        : `Conteo N° ${resultado.numero} aprobado: se ajustaron ${resultado.cambios.length} ${resultado.cambios.length === 1 ? "material" : "materiales"}.`,
    ];
    if (resultado.sinContar > 0) {
      avisos.push(
        `${resultado.sinContar} ${resultado.sinContar === 1 ? "material no se contó" : "materiales no se contaron"} y quedaron como estaban.`,
      );
    }
    return { ...(await detalleDeConteo(id)), ajustes: resultado.cambios, avisos };
  });

  app.post("/bloques/conteos/:id/cancelar", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = motivoSchema.parse(req.body);
    const hecho = await db.transaction(async (tx) => {
      const [c] = await tx.select().from(materialCounts).where(eq(materialCounts.id, id));
      if (!c) return null;
      if (c.status !== "abierto") {
        throw Object.assign(new Error(`Ese conteo ya está ${c.status === "aprobado" ? "aprobado" : "cancelado"}.`), {
          statusCode: 409,
        });
      }
      await tx
        .update(materialCounts)
        .set({ status: "cancelado", cancelledAt: new Date(), cancelReason: body.reason, updatedAt: new Date() })
        .where(eq(materialCounts.id, id));
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "material_counts",
        entityId: id,
        action: "update",
        oldValues: { status: "abierto" },
        newValues: { status: "cancelado", reason: body.reason },
      });
      return true;
    });
    if (!hecho) return reply.code(404).send({ error: "Ese conteo no existe." });
    return detalleDeConteo(id);
  });
}
