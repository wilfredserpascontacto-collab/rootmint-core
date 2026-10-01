import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { customers, quotes } from "../db/schema.js";
import { installations } from "../db/schema-servicio.js";
import { logActivity } from "../lib/activity-log.js";
import { nextCorrelativo } from "../lib/counters.js";
import { getRol, getUserId } from "../lib/request-context.js";
import { hoyEnElSalvador } from "../lib/fechas.js";
import { dia, texto } from "../lib/validar.js";
import { garantiasDe, resumenDeInstalacion, vistaDeGarantia } from "./garantias.js";
import { warranties } from "../db/schema-servicio.js";

const createSchema = z.object({
  customerId: z.string().uuid("Elegí a qué cliente pertenece."),
  quoteId: z.string().uuid().nullable().optional(),
  label: texto("cómo le dice el cliente", 120),
  address: texto("la dirección", 400),
  description: texto("qué se instaló", 4000),
  // Nulo es «todavía no se entrega»; no es lo mismo que «se entregó hoy».
  deliveredAt: dia.nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

const updateSchema = createSchema.partial();

/**
 * Texto sin tildes ni mayusculas, para buscar como se habla.
 *
 * Quien llama dice «perez» y el cliente esta guardado como «Pérez»; quien
 * teclea con una mano en una obra no pone tildes. Se normalizan los dos lados
 * con la misma regla —en SQL con translate, que existe en cualquier Postgres,
 * sin depender de una extension que quiza no este instalada—.
 */
const SIN_TILDES = (c: unknown) =>
  sql`translate(lower(${c}), 'áéíóúüñ', 'aeiouun')`;

function sinTildes(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ñ/g, "n");
}

/** Lo que toda respuesta lleva: la instalacion y el cliente al que pertenece. */
const COLUMNAS = {
  id: installations.id,
  number: installations.number,
  customerId: installations.customerId,
  customerName: customers.name,
  quoteId: installations.quoteId,
  label: installations.label,
  address: installations.address,
  description: installations.description,
  deliveredAt: installations.deliveredAt,
  notes: installations.notes,
  createdAt: installations.createdAt,
  updatedAt: installations.updatedAt,
};

export async function instalacionesRoutes(app: FastifyInstance) {
  /**
   * Por ahora el nivel de solo lectura no entra aca.
   *
   * La propuesta es que quien esta en la calle vea unicamente lo suyo: las
   * visitas que le tocan y las direcciones de esas visitas. Todavia no existen
   * visitas, y mientras no existan la unica forma de «ver lo suyo» seria ver
   * todas las direcciones de todos los clientes. Se cierra hasta que haya con
   * que filtrar: abrir despues es facil; cerrar despues de que alguien se
   * acostumbro, no.
   */
  app.addHook("preHandler", async (req, reply) => {
    if (getRol(req) === "viewer") {
      return reply.code(403).send({
        error: "Tu cuenta es de solo lectura y todavía no tiene instalaciones asignadas.",
      });
    }
  });

  /**
   * Buscar instalaciones.
   *
   * `q` busca en cómo le dicen, dirección, qué se instaló, nombre del cliente
   * y número (con o sin «INS-»). Es lo que se usa con el telefono en la mano.
   * `entrega` separa las que ya se entregaron de las que no.
   */
  app.get("/instalaciones", async (req) => {
    const { q, customerId, entrega } = req.query as {
      q?: string;
      customerId?: string;
      entrega?: string;
    };

    const condiciones: SQL[] = [isNull(installations.deletedAt)];

    if (customerId) condiciones.push(eq(installations.customerId, customerId));
    if (entrega === "entregada") condiciones.push(sql`${installations.deliveredAt} is not null`);
    if (entrega === "pendiente") condiciones.push(sql`${installations.deliveredAt} is null`);

    const busca = sinTildes((q ?? "").trim());
    if (busca) {
      const patron = `%${busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const numero = /^(?:ins-?)?0*(\d{1,9})$/.exec(busca);
      const porTexto = sql`(
        ${SIN_TILDES(installations.label)} like ${patron}
        or ${SIN_TILDES(installations.address)} like ${patron}
        or ${SIN_TILDES(installations.description)} like ${patron}
        or ${SIN_TILDES(customers.name)} like ${patron}
      )`;
      condiciones.push(
        numero ? sql`(${porTexto} or ${installations.number} = ${Number(numero[1])})` : porTexto,
      );
    }

    const filas = await db
      .select(COLUMNAS)
      .from(installations)
      .innerJoin(customers, eq(customers.id, installations.customerId))
      .where(and(...condiciones))
      .orderBy(desc(installations.number))
      .limit(500);

    // El estado de garantia de cada una se CALCULA aqui, de sus fechas y de
    // hoy; no esta guardado en ningun lado. Una consulta para todas.
    const hoy = hoyEnElSalvador();
    const garantias = await garantiasDe(filas.map((f) => f.id));
    return filas.map((f) => ({
      ...f,
      garantia: resumenDeInstalacion(f.deliveredAt, garantias.get(f.id) ?? [], hoy),
    }));
  });

  app.get("/instalaciones/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [fila] = await db
      .select(COLUMNAS)
      .from(installations)
      .innerJoin(customers, eq(customers.id, installations.customerId))
      .where(and(eq(installations.id, id), isNull(installations.deletedAt)));
    if (!fila) return reply.code(404).send({ error: "No encontrado" });

    // El número de la cotización de la que salió, si salió de una.
    let cotizacion: { id: string; number: number } | null = null;
    if (fila.quoteId) {
      const [c] = await db
        .select({ id: quotes.id, number: quotes.number })
        .from(quotes)
        .where(eq(quotes.id, fila.quoteId));
      cotizacion = c ?? null;
    }

    // La pregunta del dia: ¿esta instalacion esta en garantia, y hasta cuando?
    const hoy = hoyEnElSalvador();
    const propias = (await garantiasDe([fila.id])).get(fila.id) ?? [];
    return {
      ...fila,
      cotizacion,
      garantia: resumenDeInstalacion(fila.deliveredAt, propias, hoy),
      garantias: propias.map((g) => vistaDeGarantia(g, hoy)),
    };
  });

  /**
   * Verifica lo que la instalacion nombra, y devuelve avisos.
   *
   * Se corre ANTES de abrir la transaccion: con la base local de una sola
   * conexion, consultar `db` dentro de una transaccion abierta se cuelga.
   * Y es mejor asi tambien en produccion: no se reserva un numero para
   * descubrir despues que el cliente no existe.
   *
   * Un cliente o una cotizacion que no existen son errores: no hay a que
   * apuntar. Una fecha futura o una cotizacion de otro cliente son avisos:
   * pueden ser un error, y pueden ser lo que paso de verdad.
   */
  async function revisar(datos: {
    /** El cliente que se esta ELIGIENDO ahora: solo ese tiene que existir. */
    customerId?: string;
    /** Con quien se cotejan la cotizacion: el eligido, o el que ya tenia. */
    clienteDeLaInstalacion?: string;
    quoteId?: string | null;
    deliveredAt?: string | null;
  }): Promise<{ error?: string; avisos: string[] }> {
    const avisos: string[] = [];
    const customerId = datos.clienteDeLaInstalacion ?? datos.customerId;

    // Un cliente quitado despues de cargar la instalacion no impide corregirle
    // la direccion: solo se exige que exista cuando se esta eligiendo.
    if (datos.customerId) {
      const [c] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.id, datos.customerId), isNull(customers.deletedAt)));
      if (!c) return { error: "Ese cliente no existe o ya fue quitado.", avisos };
    }

    if (datos.quoteId) {
      const [c] = await db
        .select({ id: quotes.id, customerId: quotes.customerId, number: quotes.number })
        .from(quotes)
        .where(eq(quotes.id, datos.quoteId));
      if (!c) return { error: "Esa cotización no existe.", avisos };
      if (customerId && c.customerId !== customerId) {
        avisos.push(
          `La cotización COT-${String(c.number).padStart(5, "0")} es de otro cliente. Se guardó igual; revisá que sea la correcta.`,
        );
      }
    }

    if (datos.deliveredAt && datos.deliveredAt > hoyEnElSalvador()) {
      avisos.push(
        "La fecha de entrega es futura: la garantía todavía no empieza a correr. Si ya se entregó, corregí la fecha.",
      );
    }

    return { avisos };
  }

  app.post("/instalaciones", async (req, reply) => {
    const body = createSchema.parse(req.body);

    const { error, avisos } = await revisar(body);
    if (error) return reply.code(400).send({ error });

    const creada = await db.transaction(async (tx) => {
      const numero = await nextCorrelativo(tx, "installation");
      const [fila] = await tx
        .insert(installations)
        .values({
          number: numero,
          customerId: body.customerId,
          quoteId: body.quoteId ?? null,
          label: body.label,
          address: body.address,
          description: body.description,
          deliveredAt: body.deliveredAt ?? null,
          notes: body.notes || null,
          createdBy: getUserId(req),
        })
        .returning();
      if (!fila) throw new Error("No se pudo crear la instalación");

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "installations",
        entityId: fila.id,
        action: "create",
        newValues: fila,
      });
      return fila;
    });

    return reply.code(201).send({ ...creada, avisos });
  });

  /**
   * Corregir una instalacion.
   *
   * La fecha de entrega se puede corregir, y es la unica correccion que tiene
   * consecuencias: de ella cuelga cuando vence la garantia. Por eso queda en el
   * registro de actividad con el valor de antes y el de despues, como todo
   * cambio en esta tabla. Cuando existan las garantias, corregirla tendra que
   * decir tambien que pasa con las que ya se emitieron.
   */
  app.patch("/instalaciones/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);

    const [antes] = await db
      .select()
      .from(installations)
      .where(and(eq(installations.id, id), isNull(installations.deletedAt)));
    if (!antes) return reply.code(404).send({ error: "No encontrado" });

    const { error, avisos } = await revisar({
      customerId: body.customerId,
      clienteDeLaInstalacion: body.customerId ?? antes.customerId,
      // Solo se revisa la cotizacion si se esta cambiando o si se cambia el
      // cliente: no hay por que volver a avisar de algo que ya se aceptó.
      quoteId:
        "quoteId" in body || "customerId" in body ? (body.quoteId ?? antes.quoteId) : null,
      deliveredAt: body.deliveredAt,
    });
    if (error) return reply.code(400).send({ error });

    // Corregir la entrega NO mueve las garantias ya cargadas: lo que se
    // prometio queda como se prometio. Pero hay que enterarse, porque la fecha
    // de entrega era de donde se habia contado.
    if (body.deliveredAt !== undefined && body.deliveredAt !== antes.deliveredAt) {
      const vivas = ((await garantiasDe([id])).get(id) ?? []).filter((g) => !g.annulledAt);
      if (vivas.length > 0) {
        avisos.push(
          `Esta instalación tiene ${vivas.length === 1 ? "una garantía cargada" : `${vivas.length} garantías cargadas`} con la fecha de antes. No se movieron solas: revisalas.`,
        );
      }
    }

    const despues = await db.transaction(async (tx) => {
      const cambios: Partial<typeof installations.$inferInsert> = { updatedAt: new Date() };
      if (body.customerId !== undefined) cambios.customerId = body.customerId;
      if (body.quoteId !== undefined) cambios.quoteId = body.quoteId;
      if (body.label !== undefined) cambios.label = body.label;
      if (body.address !== undefined) cambios.address = body.address;
      if (body.description !== undefined) cambios.description = body.description;
      if (body.deliveredAt !== undefined) cambios.deliveredAt = body.deliveredAt;
      if (body.notes !== undefined) cambios.notes = body.notes || null;

      const [fila] = await tx
        .update(installations)
        .set(cambios)
        .where(eq(installations.id, id))
        .returning();
      if (!fila) throw new Error("No se pudo actualizar la instalación");

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "installations",
        entityId: id,
        action: "update",
        oldValues: antes,
        newValues: fila,
      });
      return fila;
    });

    return { ...despues, avisos };
  });

  /**
   * Quitar una instalacion cargada por error.
   *
   * No se borra la fila: se marca. Mientras tenga una garantia viva se niega;
   * cuando existan planes y visitas, se negara tambien por ellos.
   */
  app.delete("/instalaciones/:id", async (req, reply) => {
    const { id } = req.params as { id: string };

    const [antes] = await db
      .select()
      .from(installations)
      .where(and(eq(installations.id, id), isNull(installations.deletedAt)));
    if (!antes) return reply.code(404).send({ error: "No encontrado" });

    // Una instalacion con una garantia viva no se quita: seria dejar una
    // promesa colgando de algo que ya no aparece en ninguna lista. Primero se
    // anula la garantia, con su motivo.
    const [viva] = await db
      .select({ id: warranties.id })
      .from(warranties)
      .where(and(eq(warranties.installationId, id), isNull(warranties.deletedAt), isNull(warranties.annulledAt)))
      .limit(1);
    if (viva) {
      return reply.code(409).send({
        error: "Esta instalación tiene garantías vigentes cargadas. Anulalas primero (con su motivo) y después podés quitarla.",
      });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(installations)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(installations.id, id));
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "installations",
        entityId: id,
        action: "delete",
        oldValues: antes,
      });
    });

    return reply.code(204).send();
  });
}
