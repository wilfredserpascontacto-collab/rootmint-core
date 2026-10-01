import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { customers } from "../db/schema.js";
import { installations, warranties } from "../db/schema-servicio.js";
import { logActivity } from "../lib/activity-log.js";
import { diasEntre, hoyEnElSalvador, limitesDelMes, sumarMeses } from "../lib/fechas.js";
import { getRol, getUserId } from "../lib/request-context.js";
import { dia } from "../lib/validar.js";
import { estadoDeUna, faltanTextos, resumenDeInstalacion } from "../servicio/garantia.js";

type Fila = typeof warranties.$inferSelect;

/**
 * Una garantia como la ve la pantalla: lo guardado, mas lo que se calcula de
 * las fechas y de hoy. El estado y los dias que quedan NO estan en la tabla.
 */
export function vistaDeGarantia(g: Fila, hoy: string) {
  const estado = estadoDeUna(g, hoy);
  return {
    id: g.id,
    installationId: g.installationId,
    origin: g.origin,
    startsAt: g.startsAt,
    endsAt: g.endsAt,
    priceCents: g.priceCents,
    annulledAt: g.annulledAt,
    annulReason: g.annulReason,
    conditions: g.conditions,
    customerDuties: g.customerDuties,
    howToClaim: g.howToClaim,
    issuedBy: g.issuedBy,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    estado,
    // Cuantos dias quedan, mientras cubra; 0 es «vence hoy».
    diasRestantes: estado === "vigente" ? diasEntre(hoy, g.endsAt) : null,
    // Que le falta al certificado para cumplir el Art. 33.
    faltanTextos: faltanTextos(g),
  };
}

/** Las garantias de varias instalaciones de una vez (una sola consulta). */
export async function garantiasDe(ids: string[]): Promise<Map<string, Fila[]>> {
  const porInstalacion = new Map<string, Fila[]>();
  if (ids.length === 0) return porInstalacion;
  const filas = await db
    .select()
    .from(warranties)
    .where(and(inArray(warranties.installationId, ids), isNull(warranties.deletedAt)))
    .orderBy(desc(warranties.startsAt));
  for (const f of filas) {
    const l = porInstalacion.get(f.installationId) ?? [];
    l.push(f);
    porInstalacion.set(f.installationId, l);
  }
  return porInstalacion;
}

export { resumenDeInstalacion };

const textoLibre = z.string().trim().max(4000);

const camposTexto = {
  conditions: textoLibre.optional(),
  customerDuties: textoLibre.optional(),
  howToClaim: textoLibre.optional(),
  issuedBy: textoLibre.optional(),
};

/**
 * La duracion se dice de UNA forma: en meses, o con la fecha en que vence.
 * Las dos a la vez podrian no coincidir, y no hay forma de saber cual quiso.
 */
const unaDuracion = (d: { months?: number; endsAt?: string }) => !(d.months !== undefined && d.endsAt !== undefined);
const MENSAJE_DURACION = "Indicá la duración en meses o la fecha en que vence, no las dos.";

const createSchema = z
  .object({
    // Vacia: arranca el dia de la entrega de la instalacion.
    startsAt: dia.optional(),
    months: z.number().int().min(1, "La duración mínima es 1 mes.").max(240, "Eso son más de 20 años: ¿está bien?").optional(),
    endsAt: dia.optional(),
    ...camposTexto,
  })
  .refine(unaDuracion, MENSAJE_DURACION)
  .refine((d) => d.months !== undefined || d.endsAt !== undefined, "Falta la duración: en meses, o la fecha en que vence.");

const updateSchema = z
  .object({
    startsAt: dia.optional(),
    months: z.number().int().min(1).max(240).optional(),
    endsAt: dia.optional(),
    ...camposTexto,
  })
  .refine(unaDuracion, MENSAJE_DURACION);

const anularSchema = z.object({
  reason: z.string().trim().min(3, "Escribí por qué se anula (al menos unas palabras).").max(500),
});

export async function garantiasRoutes(app: FastifyInstance) {
  /** Igual que instalaciones: quien solo mira no entra hasta que haya visitas con que filtrar. */
  app.addHook("preHandler", async (req, reply) => {
    if (getRol(req) === "viewer") {
      return reply.code(403).send({
        error: "Tu cuenta es de solo lectura y todavía no tiene instalaciones asignadas.",
      });
    }
  });

  /**
   * Avisos de una garantia que se esta cargando o corrigiendo. Ninguno
   * impide: «avisar no es impedir». Francisco puede querer dar una garantia
   * que ya nace vencida (por un acuerdo) o que empieza otro dia que la entrega.
   */
  async function avisosDe(
    inst: { id: string; deliveredAt: string | null },
    g: { startsAt: string; endsAt: string },
    hoy: string,
    excepto?: string,
  ): Promise<string[]> {
    const avisos: string[] = [];
    if (g.endsAt < hoy) avisos.push("Esta garantía ya está vencida: termina antes de hoy.");
    if (inst.deliveredAt && g.startsAt !== inst.deliveredAt) {
      avisos.push(`Empieza un día distinto al de la entrega de la instalación (${inst.deliveredAt}). Se guardó como la escribiste.`);
    }
    const otras = (await garantiasDe([inst.id])).get(inst.id) ?? [];
    const seSolapa = otras.some(
      (o) => o.id !== excepto && !o.annulledAt && o.origin === "legal" && o.startsAt <= g.endsAt && g.startsAt <= o.endsAt,
    );
    if (seSolapa) avisos.push("Esta instalación ya tiene otra garantía del trabajo que cubre parte de las mismas fechas.");
    return avisos;
  }

  /** Cargar la garantia de una instalacion. La duracion es libre: 6 meses, un año, la que se pacte. */
  app.post("/instalaciones/:id/garantias", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = createSchema.parse(req.body);

    const [inst] = await db
      .select({ id: installations.id, deliveredAt: installations.deliveredAt })
      .from(installations)
      .where(and(eq(installations.id, id), isNull(installations.deletedAt)));
    if (!inst) return reply.code(404).send({ error: "No encontrado" });

    const startsAt = body.startsAt ?? inst.deliveredAt;
    if (!startsAt) {
      return reply.code(400).send({
        error: "Esta instalación no tiene fecha de entrega. Indicá desde qué día corre la garantía, o cargá primero la fecha de entrega.",
      });
    }
    const endsAt = body.endsAt ?? sumarMeses(startsAt, body.months!);
    if (endsAt < startsAt) {
      return reply.code(400).send({ error: "La garantía no puede terminar antes de empezar." });
    }

    const hoy = hoyEnElSalvador();
    const avisos = await avisosDe(inst, { startsAt, endsAt }, hoy);

    const creada = await db.transaction(async (tx) => {
      const [fila] = await tx
        .insert(warranties)
        .values({
          installationId: id,
          origin: "legal",
          startsAt,
          endsAt,
          conditions: body.conditions ?? "",
          customerDuties: body.customerDuties ?? "",
          howToClaim: body.howToClaim ?? "",
          issuedBy: body.issuedBy ?? "",
          createdBy: getUserId(req),
        })
        .returning();
      if (!fila) throw new Error("No se pudo crear la garantía");
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "warranties",
        entityId: fila.id,
        action: "create",
        newValues: fila,
      });
      return fila;
    });

    return reply.code(201).send({ ...vistaDeGarantia(creada, hoy), avisos });
  });

  /**
   * Corregir una garantia.
   *
   * Se puede cambiar cuando empieza, cuando termina (con la fecha o con los
   * meses) y los cuatro textos. Cada cambio queda en el registro de actividad
   * con el valor de antes y el de despues: poder corregir no es poder
   * reescribir la historia sin que se note. Una anulada no se toca: se da una nueva.
   */
  app.patch("/garantias/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);

    const [antes] = await db
      .select()
      .from(warranties)
      .where(and(eq(warranties.id, id), isNull(warranties.deletedAt)));
    if (!antes) return reply.code(404).send({ error: "No encontrado" });
    if (antes.annulledAt) {
      return reply.code(409).send({ error: "Esta garantía está anulada y no se corrige. Si hace falta una, cargá una nueva." });
    }

    const startsAt = body.startsAt ?? antes.startsAt;
    // Cambiar solo el inicio NO mueve el fin: el fin es lo que se prometio.
    const endsAt = body.endsAt ?? (body.months !== undefined ? sumarMeses(startsAt, body.months) : antes.endsAt);
    if (endsAt < startsAt) {
      return reply.code(400).send({ error: "La garantía no puede terminar antes de empezar." });
    }

    const [inst] = await db
      .select({ id: installations.id, deliveredAt: installations.deliveredAt })
      .from(installations)
      .where(eq(installations.id, antes.installationId));
    const hoy = hoyEnElSalvador();
    const avisos = inst ? await avisosDe(inst, { startsAt, endsAt }, hoy, id) : [];

    const despues = await db.transaction(async (tx) => {
      const [fila] = await tx
        .update(warranties)
        .set({
          startsAt,
          endsAt,
          ...(body.conditions !== undefined && { conditions: body.conditions }),
          ...(body.customerDuties !== undefined && { customerDuties: body.customerDuties }),
          ...(body.howToClaim !== undefined && { howToClaim: body.howToClaim }),
          ...(body.issuedBy !== undefined && { issuedBy: body.issuedBy }),
          updatedAt: new Date(),
        })
        .where(eq(warranties.id, id))
        .returning();
      if (!fila) throw new Error("No se pudo actualizar la garantía");
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "warranties",
        entityId: id,
        action: "update",
        oldValues: antes,
        newValues: fila,
      });
      return fila;
    });

    return { ...vistaDeGarantia(despues, hoy), avisos };
  });

  /** Anular: la garantia no se borra, se marca con el motivo. Deja de contar para «en garantia». */
  app.post("/garantias/:id/anular", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { reason } = anularSchema.parse(req.body);

    const [antes] = await db
      .select()
      .from(warranties)
      .where(and(eq(warranties.id, id), isNull(warranties.deletedAt)));
    if (!antes) return reply.code(404).send({ error: "No encontrado" });
    if (antes.annulledAt) return reply.code(409).send({ error: "Esta garantía ya estaba anulada." });

    const despues = await db.transaction(async (tx) => {
      const [fila] = await tx
        .update(warranties)
        .set({ annulledAt: new Date(), annulledBy: getUserId(req), annulReason: reason, updatedAt: new Date() })
        .where(eq(warranties.id, id))
        .returning();
      if (!fila) throw new Error("No se pudo anular la garantía");
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "warranties",
        entityId: id,
        action: "update",
        oldValues: antes,
        newValues: fila,
      });
      return fila;
    });

    return vistaDeGarantia(despues, hoyEnElSalvador());
  });

  /**
   * Las garantias que terminan en un periodo: «las que vencen este mes».
   *
   * `desde` y `hasta` son dias (inclusive) y se comparan contra el dia en que
   * TERMINA la garantia. Sin ellos se toma el mes actual. Se incluyen las que
   * ya vencieron dentro del periodo: el 3 de este mes una garantia vencio y
   * sigue siendo de las de «este mes»; sacarla de la lista seria perderla.
   * Las anuladas no aparecen, salvo que se pidan.
   */
  app.get("/garantias", async (req, reply) => {
    const { desde, hasta, incluirAnuladas } = req.query as {
      desde?: string;
      hasta?: string;
      incluirAnuladas?: string;
    };
    const hoy = hoyEnElSalvador();
    const mes = limitesDelMes(hoy);
    const d = dia.safeParse(desde ?? mes.desde);
    const h = dia.safeParse(hasta ?? mes.hasta);
    if (!d.success || !h.success) {
      return reply.code(400).send({ error: "Las fechas tienen que ser días, como 2026-03-15." });
    }
    if (h.data < d.data) return reply.code(400).send({ error: "El periodo termina antes de empezar." });

    const condiciones: SQL[] = [
      isNull(warranties.deletedAt),
      isNull(installations.deletedAt),
      sql`${warranties.endsAt} >= ${d.data}`,
      sql`${warranties.endsAt} <= ${h.data}`,
    ];
    if (incluirAnuladas !== "true") condiciones.push(isNull(warranties.annulledAt));

    const filas = await db
      .select({
        g: warranties,
        instalacionId: installations.id,
        instalacionNumero: installations.number,
        etiqueta: installations.label,
        direccion: installations.address,
        clienteId: customers.id,
        clienteNombre: customers.name,
      })
      .from(warranties)
      .innerJoin(installations, eq(installations.id, warranties.installationId))
      .innerJoin(customers, eq(customers.id, installations.customerId))
      .where(and(...condiciones))
      .orderBy(asc(warranties.endsAt), asc(installations.number))
      .limit(500);

    return filas.map((f) => ({
      ...vistaDeGarantia(f.g, hoy),
      instalacion: { id: f.instalacionId, number: f.instalacionNumero, label: f.etiqueta, address: f.direccion },
      customer: { id: f.clienteId, name: f.clienteNombre },
    }));
  });

  /**
   * Los textos de la ultima garantia emitida, para no teclear los cuatro
   * parrafos del Art. 33 en cada una. Es solo una sugerencia que la pantalla
   * copia al formulario: cada garantia guarda SUS propios textos.
   */
  app.get("/garantias/plantilla", async () => {
    const filas = await db
      .select({
        conditions: warranties.conditions,
        customerDuties: warranties.customerDuties,
        howToClaim: warranties.howToClaim,
        issuedBy: warranties.issuedBy,
      })
      .from(warranties)
      .where(and(isNull(warranties.deletedAt), isNull(warranties.annulledAt)))
      .orderBy(desc(warranties.createdAt))
      .limit(20);
    const con = filas.find((f) => faltanTextos(f).length < 4);
    return con ?? { conditions: "", customerDuties: "", howToClaim: "", issuedBy: "" };
  });
}
