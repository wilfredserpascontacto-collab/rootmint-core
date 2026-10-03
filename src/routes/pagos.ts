/**
 * Cobros y estado de cuenta: donde la factura deja de ser deuda.
 *
 * Una factura se cobra en una o varias veces. El saldo no se guarda en ningun
 * lado: es el total de la factura menos lo cobrado, calculado cada vez. Un
 * cobro equivocado no se borra, se anula con su motivo y deja de contar.
 *
 * Igual que en el resto del sistema, se avisa antes que impedir: si alguien
 * cobra de mas, el cobro se anota y el aviso dice cuanto queda a favor del
 * cliente. Lo que si se impide es lo que dejaria los libros sin explicacion
 * (cobrar una factura anulada, o anular una factura con cobros vivos).
 */
import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { customers, invoices, payments } from "../db/schema.js";
import { logActivity } from "../lib/activity-log.js";
import { getUserId } from "../lib/request-context.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const dinero = (c: number) =>
  `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Un cobro de mas de veinte millones de dolares es un dedazo. */
const TOPE = 2_000_000_000;

const cobroSchema = z.object({
  amountCents: z
    .number({ invalid_type_error: "El monto tiene que ser un número." })
    .int("El monto va en centavos, sin decimales.")
    .positive("El monto tiene que ser mayor que cero.")
    .max(TOPE, "Ese monto es demasiado grande: revisá los ceros."),
  paidOn: z.coerce.date().optional(),
  method: z.enum(["efectivo", "transferencia", "cheque", "tarjeta", "otro"]).default("efectivo"),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(2000).optional(),
});

const anularSchema = z.object({
  reason: z.string().trim().min(3, "Decí por qué se anula el cobro: dentro de seis meses nadie va a recordarlo."),
});

/** Cuanto se ha cobrado de cada factura, contando solo los cobros vivos. */
export async function cobradoPorFactura(tx: Tx | typeof db, ids: string[]) {
  if (ids.length === 0) return new Map<string, number>();
  const filas = await tx
    .select({
      invoiceId: payments.invoiceId,
      cobrado: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int`,
    })
    .from(payments)
    .where(
      and(inArray(payments.invoiceId, ids), isNull(payments.annulledAt), isNull(payments.deletedAt)),
    )
    .groupBy(payments.invoiceId);
  return new Map(filas.map((f) => [f.invoiceId, Number(f.cobrado) || 0]));
}

const MS_DIA = 24 * 60 * 60 * 1000;

/** Fecha en que vence una factura, si al cliente se le dio plazo. Sin plazo no hay vencimiento. */
function vencimiento(emitida: Date, plazoDias: number | null): Date | null {
  if (plazoDias === null || plazoDias === undefined) return null;
  return new Date(emitida.getTime() + plazoDias * MS_DIA);
}

type EstadoFactura = "anulada" | "pagada" | "vencida" | "parcial" | "pendiente";

function estadoDe(
  f: { status: "issued" | "annulled"; totalCents: number },
  cobrado: number,
  vence: Date | null,
  ahora: Date,
): EstadoFactura {
  if (f.status === "annulled") return "anulada";
  const saldo = f.totalCents - cobrado;
  if (saldo <= 0) return "pagada";
  if (vence && vence.getTime() < ahora.getTime()) return "vencida";
  return cobrado > 0 ? "parcial" : "pendiente";
}

export async function pagosRoutes(app: FastifyInstance) {
  /** Los cobros de una factura, con su saldo. */
  app.get("/invoices/:id/pagos", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [factura] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!factura) return reply.code(404).send({ error: "Esa factura no existe." });

    const cobros = await db
      .select()
      .from(payments)
      .where(and(eq(payments.invoiceId, id), isNull(payments.deletedAt)))
      .orderBy(asc(payments.paidOn), asc(payments.createdAt));
    const cobrado = (await cobradoPorFactura(db, [id])).get(id) ?? 0;

    return {
      invoiceId: id,
      status: factura.status,
      totalCents: factura.totalCents,
      cobradoCents: cobrado,
      saldoCents: factura.status === "annulled" ? 0 : factura.totalCents - cobrado,
      pagos: cobros,
    };
  });

  /** Anotar que el cliente pago, todo o una parte. */
  app.post("/invoices/:id/pagos", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = cobroSchema.parse(req.body);

    const resultado = await db.transaction(async (tx) => {
      const [factura] = await tx.select().from(invoices).where(eq(invoices.id, id));
      if (!factura) {
        throw Object.assign(new Error("Esa factura no existe."), { statusCode: 404 });
      }
      if (factura.status === "annulled") {
        throw Object.assign(
          new Error("Esa factura está anulada: no se le puede anotar un cobro."),
          { statusCode: 409 },
        );
      }

      const antes = (await cobradoPorFactura(tx, [id])).get(id) ?? 0;
      const saldoAntes = factura.totalCents - antes;

      const [cobro] = await tx
        .insert(payments)
        .values({
          invoiceId: id,
          amountCents: body.amountCents,
          paidOn: body.paidOn ?? new Date(),
          method: body.method,
          reference: body.reference || null,
          note: body.note || null,
          createdBy: getUserId(req),
        })
        .returning();
      if (!cobro) throw new Error("No se pudo anotar el cobro.");

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "payments",
        entityId: cobro.id,
        action: "create",
        newValues: cobro,
      });

      const saldo = saldoAntes - body.amountCents;
      const avisos: string[] = [];
      if (saldoAntes <= 0) {
        avisos.push(
          "Esta factura ya estaba cobrada por completo: este cobro queda a favor del cliente.",
        );
      } else if (saldo < 0) {
        avisos.push(
          `La factura debía ${dinero(saldoAntes)} y se anotaron ${dinero(body.amountCents)}: quedan ${dinero(-saldo)} a favor del cliente.`,
        );
      } else if (saldo === 0) {
        avisos.push("Con este cobro la factura queda pagada por completo.");
      }

      return { cobro, saldoCents: saldo, avisos };
    });

    return reply.code(201).send({
      ...resultado.cobro,
      saldoCents: resultado.saldoCents,
      avisos: resultado.avisos,
    });
  });

  /** Anular un cobro. No se borra: queda escrito y deja de contar. */
  app.post("/pagos/:id/anular", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = anularSchema.parse(req.body);

    const resultado = await db.transaction(async (tx) => {
      const [antes] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, id), isNull(payments.deletedAt)));
      if (!antes) return null;
      if (antes.annulledAt) {
        throw Object.assign(new Error("Ese cobro ya estaba anulado."), { statusCode: 409 });
      }

      const [despues] = await tx
        .update(payments)
        .set({
          annulledAt: new Date(),
          annulReason: body.reason,
          annulledBy: getUserId(req),
          updatedAt: new Date(),
        })
        .where(eq(payments.id, id))
        .returning();

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "payments",
        entityId: id,
        action: "update",
        oldValues: { annulledAt: null },
        newValues: { annulledAt: despues?.annulledAt, reason: body.reason },
      });

      const [factura] = await tx.select().from(invoices).where(eq(invoices.id, antes.invoiceId));
      const cobrado = (await cobradoPorFactura(tx, [antes.invoiceId])).get(antes.invoiceId) ?? 0;
      return { cobro: despues, saldoCents: (factura?.totalCents ?? 0) - cobrado, monto: antes.amountCents };
    });

    if (!resultado) return reply.code(404).send({ error: "Ese cobro no existe." });
    return {
      ...resultado.cobro,
      saldoCents: resultado.saldoCents,
      avisos: [
        `Quedó anulado el cobro de ${dinero(resultado.monto)}. La factura vuelve a deber ${dinero(resultado.saldoCents)}.`,
      ],
    };
  });

  /**
   * El estado de cuenta: todo lo que se le ha facturado a un cliente, todo lo
   * que ha pagado y lo que queda. Es lo que se le muestra o se le manda cuando
   * pregunta «¿cuánto debo?».
   */
  app.get("/customers/:id/estado-cuenta", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [cliente] = await db.select().from(customers).where(eq(customers.id, id));
    if (!cliente) return reply.code(404).send({ error: "Ese cliente no existe." });

    const ahora = new Date();
    const facturas = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.customerId, id), isNull(invoices.deletedAt)))
      .orderBy(asc(invoices.issueDate), asc(invoices.number));
    const ids = facturas.map((f) => f.id);
    const cobrado = await cobradoPorFactura(db, ids);

    const cobros = ids.length
      ? await db
          .select()
          .from(payments)
          .where(and(inArray(payments.invoiceId, ids), isNull(payments.deletedAt)))
          .orderBy(desc(payments.paidOn), desc(payments.createdAt))
      : [];
    const porId = new Map(facturas.map((f) => [f.id, f]));

    const renglones = facturas.map((f) => {
      const pagado = f.status === "annulled" ? 0 : (cobrado.get(f.id) ?? 0);
      const vence = vencimiento(f.issueDate, cliente.creditTermDays);
      const estado = estadoDe(f, pagado, vence, ahora);
      const saldo = f.status === "annulled" ? 0 : f.totalCents - pagado;
      return {
        id: f.id,
        kind: f.kind,
        number: f.number,
        issueDate: f.issueDate,
        dueDate: f.status === "annulled" ? null : vence,
        status: f.status,
        estado,
        totalCents: f.totalCents,
        cobradoCents: pagado,
        saldoCents: saldo,
        diasVencida:
          estado === "vencida" && vence ? Math.floor((ahora.getTime() - vence.getTime()) / MS_DIA) : null,
      };
    });

    const vivas = renglones.filter((r) => r.status === "issued");
    const facturado = vivas.reduce((a, r) => a + r.totalCents, 0);
    const cobradoTotal = vivas.reduce((a, r) => a + r.cobradoCents, 0);
    const saldo = facturado - cobradoTotal;
    const vencido = vivas
      .filter((r) => r.estado === "vencida")
      .reduce((a, r) => a + r.saldoCents, 0);

    const avisos: string[] = [];
    const limite = cliente.creditLimitCents;
    if (limite !== null && limite !== undefined && saldo > limite) {
      avisos.push(
        `${cliente.name} debe ${dinero(saldo)} y su tope de crédito es ${dinero(limite)}: lo pasa por ${dinero(saldo - limite)}.`,
      );
    }
    if (vencido > 0) {
      avisos.push(
        `Hay ${dinero(vencido)} vencidos (plazo de ${cliente.creditTermDays} días).`,
      );
    }
    if (saldo < 0) {
      avisos.push(`${cliente.name} tiene ${dinero(-saldo)} a su favor.`);
    }

    return {
      customer: {
        id: cliente.id,
        name: cliente.name,
        nit: cliente.nit,
        nrc: cliente.nrc,
        creditLimitCents: cliente.creditLimitCents,
        creditTermDays: cliente.creditTermDays,
      },
      generadoEn: ahora,
      facturas: renglones,
      pagos: cobros.map((c) => ({
        id: c.id,
        invoiceId: c.invoiceId,
        invoiceNumber: porId.get(c.invoiceId)?.number ?? null,
        invoiceKind: porId.get(c.invoiceId)?.kind ?? null,
        amountCents: c.amountCents,
        paidOn: c.paidOn,
        method: c.method,
        reference: c.reference,
        note: c.note,
        annulledAt: c.annulledAt,
        annulReason: c.annulReason,
      })),
      totales: {
        facturadoCents: facturado,
        cobradoCents: cobradoTotal,
        saldoCents: saldo,
        vencidoCents: vencido,
      },
      avisos,
    };
  });

  /**
   * Quien debe: los clientes con saldo, del que mas debe al que menos.
   *
   * Es la pregunta de cada manana —¿a quien hay que llamar?— y por eso trae lo
   * vencido y la factura mas vieja sin cobrar de cada uno.
   */
  app.get("/cobros/por-cobrar", async () => {
    const ahora = new Date();
    const facturas = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.status, "issued"), isNull(invoices.deletedAt)));
    const cobrado = await cobradoPorFactura(
      db,
      facturas.map((f) => f.id),
    );
    const clientes = await db.select().from(customers);
    const porCliente = new Map(clientes.map((c) => [c.id, c]));

    const acumulado = new Map<
      string,
      { saldo: number; vencido: number; facturas: number; masVieja: Date | null }
    >();
    for (const f of facturas) {
      const saldo = f.totalCents - (cobrado.get(f.id) ?? 0);
      if (saldo <= 0) continue;
      const cli = porCliente.get(f.customerId);
      const vence = vencimiento(f.issueDate, cli?.creditTermDays ?? null);
      const a = acumulado.get(f.customerId) ?? { saldo: 0, vencido: 0, facturas: 0, masVieja: null };
      a.saldo += saldo;
      a.facturas += 1;
      if (vence && vence.getTime() < ahora.getTime()) a.vencido += saldo;
      if (!a.masVieja || f.issueDate.getTime() < a.masVieja.getTime()) a.masVieja = f.issueDate;
      acumulado.set(f.customerId, a);
    }

    const filas = [...acumulado.entries()]
      .map(([customerId, a]) => {
        const cli = porCliente.get(customerId);
        const limite = cli?.creditLimitCents ?? null;
        return {
          customerId,
          name: cli?.name ?? "Cliente",
          phone: cli?.phone ?? null,
          saldoCents: a.saldo,
          vencidoCents: a.vencido,
          facturasPendientes: a.facturas,
          facturaMasViejaDesde: a.masVieja,
          diasDesdeLaMasVieja: a.masVieja
            ? Math.floor((ahora.getTime() - a.masVieja.getTime()) / MS_DIA)
            : null,
          creditLimitCents: limite,
          pasaDelTope: limite !== null && a.saldo > limite,
        };
      })
      .sort((x, y) => y.saldoCents - x.saldoCents);

    return {
      clientes: filas,
      totales: {
        saldoCents: filas.reduce((a, f) => a + f.saldoCents, 0),
        vencidoCents: filas.reduce((a, f) => a + f.vencidoCents, 0),
      },
    };
  });
}
