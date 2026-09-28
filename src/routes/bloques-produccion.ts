/**
 * Recetas, lotes y ensayos.
 *
 * Dos reglas que se sostienen desde acá:
 *
 *  1. Al abrir un lote se CONGELA el costo con los precios de ese día, en
 *     batch_lines. Si el cemento sube en septiembre, el lote de agosto sigue
 *     costando lo de agosto.
 *
 *  2. No hay ningún endpoint que devuelva el costo de un lote sin devolver
 *     también en qué estado está su resistencia. Es la regla del módulo, y
 *     vive en la forma de la API, no en un comentario.
 */

import type { FastifyInstance } from "fastify";
import { and, eq, ne, isNull, desc, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  recipes,
  recipeLines,
  batches,
  batchLines,
  tests,
  materials,
  units,
  blockTypes,
  maintenanceLogs,
  productionOrders,
  productionOrderLines,
} from "../db/schema-bloques.js";
import { counters } from "../db/schema.js";
import { logActivity } from "../lib/activity-log.js";
import { getUserId } from "../lib/request-context.js";
import { moverInventario } from "./inventario.js";
import { revisarOrden } from "./ordenes.js";
import { nextCorrelativo } from "../lib/counters.js";
import { recetaConCosto, fichaDelLote, lotesRecientes, leerResolver } from "../bloques/servicio.js";
import { vencidasAhora } from "../bloques/mantenimiento.js";

/**
 * Los topes.
 *
 * No están para desconfiar del usuario: están porque las columnas son enteros
 * de 32 bits y un cero de más al teclear reventaba la consulta con un error
 * de base de datos, que en pantalla se leía como «Error interno». Con el tope
 * puesto acá, lo que se ve es qué campo se pasó de la raya.
 */
const TOPES = {
  cantidad: 100_000_000, //   100 mil unidades de dosificación por mezcla
  bloques: 1_000_000, //      un millón de bloques en un lote
  mezclas: 10_000, //         diez mil mezclas en un lote
  porMezcla: 100_000, //      bloques que salen de una mezcla
  mpaMilli: 200_000, //       200 MPa: el triple del hormigón más fuerte que existe
  dias: 3_650, //             diez años de curado
  probetas: 1_000,
} as const;

const renglonSchema = z.object({
  materialId: z.string().uuid(),
  quantityMilli: z.number().int().positive().max(TOPES.cantidad),
  /** Se ignora: la unidad la manda el material. Se acepta por compatibilidad. */
  unitId: z.string().uuid().optional(),
});

const recetaSchema = z.object({
  code: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  blockTypeId: z.string().uuid(),
  expectedBlocksPerMix: z.number().int().positive().max(TOPES.porMezcla),
  notes: z.string().max(2000).optional(),
  renglones: z.array(renglonSchema).min(1).max(40),
});

export async function bloquesProduccionRoutes(app: FastifyInstance) {
  // --- Recetas -------------------------------------------------------------

  app.get("/bloques/recetas", async () =>
    db
      .select({
        id: recipes.id,
        code: recipes.code,
        name: recipes.name,
        status: recipes.status,
        expectedBlocksPerMix: recipes.expectedBlocksPerMix,
        blockTypeId: recipes.blockTypeId,
        tipoBloque: blockTypes.name,
      })
      .from(recipes)
      .leftJoin(blockTypes, eq(recipes.blockTypeId, blockTypes.id))
      .where(isNull(recipes.deletedAt))
      .orderBy(recipes.name),
  );

  /** La receta con su costo teórico y sus advertencias contra los rangos. */
  app.get("/bloques/recetas/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await recetaConCosto(id);
    if (!r) return reply.code(404).send({ error: "No encontrada" });
    return r;
  });

  app.post("/bloques/recetas", async (req, reply) => {
    const body = recetaSchema.parse(req.body);

    /**
     * La unidad de un renglón NO la elige quien arma la receta: es la unidad
     * de dosificación del material y punto.
     *
     * Las cantidades del sistema viajan en milésimas de esa unidad, y el costo
     * las divide contra `contentPerPurchaseMilli`, que está expresado en esa
     * misma unidad. Si un renglón dijera "2 baldes" de un material que se
     * dosifica en carretillas, el número se leería igual —como carretillas— y
     * el costo saldría mal sin una sola señal. Se resuelve acá, del lado del
     * servidor, para que la regla valga aunque la petición venga de otro lado.
     */
    const usados = await db
      .select({ id: materials.id, dosingUnitId: materials.dosingUnitId, nombre: materials.name })
      .from(materials)
      .where(and(inArray(materials.id, body.renglones.map((l) => l.materialId)), isNull(materials.deletedAt)));

    const porId = new Map(usados.map((m) => [m.id, m]));
    const desconocidos = body.renglones.filter((l) => !porId.has(l.materialId));
    if (desconocidos.length > 0) {
      return reply.code(400).send({
        error: "Hay materiales que no existen en el catálogo",
        detalle: desconocidos.map((l) => l.materialId),
      });
    }

    const creada = await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(recipes)
        .values({
          code: body.code,
          name: body.name,
          blockTypeId: body.blockTypeId,
          expectedBlocksPerMix: body.expectedBlocksPerMix,
          notes: body.notes,
          status: "draft",
          createdBy: getUserId(req),
        })
        .returning();
      if (!r) throw new Error("No se pudo crear la receta");

      await tx.insert(recipeLines).values(
        body.renglones.map((l, i) => ({
          recipeId: r.id,
          materialId: l.materialId,
          quantityMilli: l.quantityMilli,
          unitId: porId.get(l.materialId)?.dosingUnitId ?? null,
          displayOrder: i,
        })),
      );

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "recipes",
        entityId: r.id,
        action: "create",
        newValues: r,
      });
      return r;
    });
    return reply.code(201).send(await recetaConCosto(creada.id));
  });

  /**
   * Validar una receta exige un lote suyo que CUMPLA en un ensayo real.
   * No se valida por decreto: eso convertiría el estado en decoración.
   */
  app.post("/bloques/recetas/:id/validar", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [receta] = await db.select().from(recipes).where(eq(recipes.id, id));
    if (!receta) return reply.code(404).send({ error: "No encontrada" });

    const res = await leerResolver();
    const [tipo] = await db.select().from(blockTypes).where(eq(blockTypes.id, receta.blockTypeId));
    const objetivo =
      tipo?.targetStrengthMpaMilli ?? res.numero("proceso.resistencia_objetivo_mpa_milli");
    const criterio = tipo?.targetStrengthBasis ?? "net";

    const respaldo = await db
      .select({ testId: tests.id, mpa: tests.strengthMpaMilli, basis: tests.basis, batch: batches.number })
      .from(tests)
      .innerJoin(batches, eq(tests.batchId, batches.id))
      .where(eq(batches.recipeId, id));

    const bueno = respaldo.find((t) => t.basis === criterio && t.mpa >= objetivo);
    if (!bueno) {
      return reply.code(409).send({
        error: "No se puede validar",
        detalle:
          respaldo.length === 0
            ? "Ningún lote de esta receta tiene ensayo todavía."
            : `Ningún ensayo alcanza ${objetivo / 1000} MPa en área ${criterio === "net" ? "neta" : "bruta"}.`,
        ensayos: respaldo,
      });
    }

    const [after] = await db
      .update(recipes)
      .set({ status: "validated", updatedAt: new Date() })
      .where(eq(recipes.id, id))
      .returning();
    return after;
  });

  // --- Lotes ---------------------------------------------------------------

  app.get("/bloques/lotes", async () => lotesRecientes());

  /** Costo y resistencia, juntos. No hay forma de pedir solo uno. */
  app.get("/bloques/lotes/:id/ficha", async (req, reply) => {
    const { id } = req.params as { id: string };
    const f = await fichaDelLote(id);
    if (!f) return reply.code(404).send({ error: "No encontrado" });
    return f;
  });

  const loteSchema = z.object({
    recipeId: z.string().uuid(),
    /**
     * Contra qué orden se corre. Opcional a propósito: producir para tener
     * existencia, sin que nadie lo haya pedido, es normal en una bloquera y
     * no debería costar un trámite.
     */
    productionOrderId: z.string().uuid().optional(),
    producedAt: z.coerce.date().optional(),
    mixes: z.number().int().positive().max(TOPES.mezclas).default(1),
    blocksGood: z.number().int().nonnegative().max(TOPES.bloques).default(0),
    blocksBroken: z.number().int().nonnegative().max(TOPES.bloques).default(0),
    notes: z.string().max(2000).optional(),
  });

  /**
   * Abrir un lote congela el costo del material con los precios de hoy.
   * Se guarda renglón por renglón en batch_lines: el nombre y el precio
   * quedan escritos, no referenciados.
   */
  app.post("/bloques/lotes", async (req, reply) => {
    const body = loteSchema.parse(req.body);

    const [receta] = await db.select().from(recipes).where(eq(recipes.id, body.recipeId));
    if (!receta) return reply.code(400).send({ error: "La receta no existe" });

    /**
     * La orden se valida ANTES de abrir la transacción, no adentro.
     *
     * Es la lección de la sesión pasada: en modo local la base es de una sola
     * conexión, y consultar desde dentro de una transacción abierta traba el
     * proceso entero sin dar error. Lo que se puede preguntar antes, se
     * pregunta antes.
     */
    if (body.productionOrderId) {
      const [orden] = await db
        .select()
        .from(productionOrders)
        .where(eq(productionOrders.id, body.productionOrderId));
      if (!orden) return reply.code(400).send({ error: "Esa orden de producción no existe." });
      if (orden.status === "anulada") {
        return reply.code(409).send({
          error: `La orden N° ${orden.number} está anulada. Si el bloque se fabricó igual, cerrá el lote sin orden: el bloque existe aunque la orden no.`,
        });
      }
      const [renglon] = await db
        .select()
        .from(productionOrderLines)
        .where(
          and(
            eq(productionOrderLines.orderId, body.productionOrderId),
            eq(productionOrderLines.blockTypeId, receta.blockTypeId),
          ),
        );
      if (!renglon) {
        return reply.code(409).send({
          error: `La orden N° ${orden.number} no pide este tipo de bloque. Elegí la receta que corresponde, o cerrá el lote sin orden.`,
        });
      }
    }

    const lineas = await db
      .select({
        materialId: recipeLines.materialId,
        quantityMilli: recipeLines.quantityMilli,
        displayOrder: recipeLines.displayOrder,
        nombre: materials.name,
        precioCents: materials.purchasePriceCents,
        contenidoMilli: materials.contentPerPurchaseMilli,
        unidad: units.abbreviation,
      })
      .from(recipeLines)
      .leftJoin(materials, eq(recipeLines.materialId, materials.id))
      .leftJoin(units, eq(materials.dosingUnitId, units.id))
      .where(eq(recipeLines.recipeId, body.recipeId))
      .orderBy(recipeLines.displayOrder);

    if (lineas.length === 0) {
      return reply.code(400).send({ error: "La receta no tiene renglones" });
    }

    /**
     * Se calcula ANTES de insertar: lo que importa es como estaba la maquina
     * cuando se corrio el lote, no despues de contarlo.
     */
    const mantenimientoVencido = await vencidasAhora();

    const creado = await db.transaction(async (tx) => {
      const numero = await nextCorrelativo(tx, "batch");

      const congeladas = lineas.map((l) => {
        const cantidad = l.quantityMilli * body.mixes;
        const contenido = Math.max(1, l.contenidoMilli ?? 1000);
        const subtotal = Math.round((cantidad * (l.precioCents ?? 0)) / contenido);
        return {
          materialId: l.materialId,
          description: l.nombre ?? "Material eliminado del catálogo",
          quantityMilli: cantidad,
          unitAbbreviation: l.unidad ?? "u",
          unitPriceCents: l.precioCents ?? 0,
          subtotalCents: subtotal,
        };
      });

      const costoTotal = congeladas.reduce((s, l) => s + l.subtotalCents, 0);

      const [lote] = await tx
        .insert(batches)
        .values({
          number: numero,
          recipeId: body.recipeId,
          blockTypeId: receta.blockTypeId,
          productionOrderId: body.productionOrderId ?? null,
          producedAt: body.producedAt ?? new Date(),
          mixes: body.mixes,
          blocksGood: body.blocksGood,
          blocksBroken: body.blocksBroken,
          materialCostCents: costoTotal,
          countSource: "person",
          maintenanceOverdue: mantenimientoVencido.length ? mantenimientoVencido : null,
          curingDays: null,
          notes: body.notes,
          createdBy: getUserId(req),
        })
        .returning();
      if (!lote) throw new Error("No se pudo crear el lote");

      await tx.insert(batchLines).values(congeladas.map((c) => ({ ...c, batchId: lote.id })));

      /**
       * Lo que se produjo entra al inventario en el mismo acto.
       *
       * En la misma transaccion a proposito: si el lote se guarda y la entrada
       * no, el patio y el sistema empiezan a decir cosas distintas, y ese
       * desfase no se descubre hasta que alguien cuenta a mano. O pasan las
       * dos cosas o no pasa ninguna.
       *
       * Solo entran los buenos. Los rotos se contaron al producir y nunca
       * fueron existencia vendible.
       */
      await moverInventario(tx, {
        blockTypeId: lote.blockTypeId,
        quantity: lote.blocksGood,
        reason: "produccion",
        refType: "batch",
        refId: lote.id,
        note: `Lote ${lote.number}`,
        userId: getUserId(req),
      });

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "batches",
        entityId: lote.id,
        action: "create",
        newValues: lote,
      });

      /**
       * Y la orden se entera en el mismo acto.
       *
       * Si esto viviera fuera de la transacción, un fallo entre las dos cosas
       * dejaría una orden diciendo que le falta lo que ya está fabricado. El
       * aviso que vuelve es lo que la planta lee después de cerrar: «quedó
       * terminada» o «le faltan tantos».
       */
      const aviso = body.productionOrderId
        ? await revisarOrden(tx, body.productionOrderId, getUserId(req))
        : null;
      return { lote, aviso };
    });

    const ficha = await fichaDelLote(creado.lote.id);
    return reply.code(201).send(creado.aviso ? { ...ficha, avisos: [creado.aviso] } : ficha);
  });

  /**
   * Solo el conteo se corrige después. El costo congelado NO se toca acá:
   * si cambió lo que entró de verdad, eso es otro lote o una corrección
   * explícita, no una edición silenciosa.
   */
  app.patch("/bloques/lotes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        blocksGood: z.number().int().nonnegative().optional(),
        blocksBroken: z.number().int().nonnegative().optional(),
        machineCycles: z.number().int().nonnegative().optional(),
        countSource: z.enum(["person", "machine"]).optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);

    const updated = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(batches).where(eq(batches.id, id));
      if (!before) return null;
      const [after] = await tx
        .update(batches)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(batches.id, id))
        .returning();

      /**
       * Si se recontaron los buenos, el inventario se mueve por la DIFERENCIA.
       *
       * Recontar 57 donde se habian anotado 60 saca 3 del inventario; no mete
       * otros 57. El movimiento queda anotado como correccion, con su lote, en
       * vez de corregir la entrada anterior: asi la historia sigue contando lo
       * que de verdad paso, incluido el error.
       */
      if (after && body.blocksGood !== undefined && before.blocksGood !== body.blocksGood) {
        await moverInventario(tx, {
          blockTypeId: after.blockTypeId,
          quantity: body.blocksGood - before.blocksGood,
          reason: "ajuste",
          refType: "batch",
          refId: id,
          note: `Recuento del lote ${after.number}: de ${before.blocksGood} a ${body.blocksGood}`,
          userId: getUserId(req),
        });

        // Y su orden se vuelve a mirar: recontar para abajo puede reabrir lo
        // que el conteo anterior daba por terminado.
        if (after.productionOrderId) {
          await revisarOrden(tx, after.productionOrderId, getUserId(req));
        }
      }

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "batches",
        entityId: id,
        action: "update",
        oldValues: before,
        newValues: after,
      });
      return after;
    });

    if (!updated) return reply.code(404).send({ error: "No encontrado" });
    return fichaDelLote(id);
  });

  // --- Ensayos -------------------------------------------------------------

  const ensayoSchema = z.object({
    testedAt: z.coerce.date().optional(),
    ageDays: z.number().int().positive().max(TOPES.dias),
    specimens: z.number().int().positive().max(TOPES.probetas).default(1),
    strengthMpaMilli: z.number().int().positive().max(TOPES.mpaMilli),
    /** Sin criterio de área un MPa no significa nada. Por eso no tiene default. */
    basis: z.enum(["net", "gross"]),
    source: z.enum(["plant", "lab"]).default("plant"),
    notes: z.string().optional(),
  });

  app.post("/bloques/lotes/:id/ensayos", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = ensayoSchema.parse(req.body);

    const [lote] = await db.select().from(batches).where(eq(batches.id, id));
    if (!lote) return reply.code(404).send({ error: "Lote no encontrado" });

    const res = await leerResolver();
    const edadEsperada = res.numero("proceso.edad_ensayo");

    await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(tests)
        .values({
          batchId: id,
          testedAt: body.testedAt ?? new Date(),
          ageDays: body.ageDays,
          specimens: body.specimens,
          strengthMpaMilli: body.strengthMpaMilli,
          basis: body.basis,
          source: body.source,
          readingSource: "person",
          notes: body.notes,
          createdBy: getUserId(req),
        })
        .returning();
      if (!t) throw new Error("No se pudo registrar el ensayo");
      await logActivity(tx, {
        userId: getUserId(req),
        entity: "tests",
        entityId: t.id,
        action: "create",
        newValues: t,
      });
    });

    const ficha = await fichaDelLote(id);
    return reply.code(201).send({
      ...ficha,
      /** Un ensayo antes de tiempo no es inválido, pero no es comparable a la norma. */
      avisoEdad:
        body.ageDays < edadEsperada
          ? `El ensayo se hizo a los ${body.ageDays} días y la norma fija la resistencia a los ${edadEsperada}.`
          : null,
    });
  });

  app.get("/bloques/lotes/:id/ensayos", async (req) => {
    const { id } = req.params as { id: string };
    return db.select().from(tests).where(eq(tests.batchId, id)).orderBy(desc(tests.testedAt));
  });

  // --- La orden del día ----------------------------------------------------

  /**
   * Lo que la pantalla de planta necesita al abrir: qué recetas se pueden
   * correr y cuántos bloques espera cada una. En la fase 1 el software es la
   * orden de trabajo, así que esto es lo primero que ve el operario.
   *
   * Devuelve las validadas Y las que están en prueba, separadas.
   *
   * Antes solo devolvía las validadas, y eso dejaba una planta nueva sin
   * salida: una receta se valida cuando un lote suyo pasa el ensayo, el lote
   * sale de correr la receta, y la pantalla no dejaba correr nada sin validar.
   * El nudo se cerraba sobre sí mismo. En una planta de verdad primero se
   * corren mezclas de prueba, se hacen las probetas y a los 28 días el ensayo
   * dice si la receta sirve. El software tiene que dejar hacer eso; lo que no
   * puede es callar que el bloque todavía no está respaldado.
   */
  app.get("/bloques/orden-del-dia", async () => {
    const todas = await db
      .select({
        id: recipes.id,
        code: recipes.code,
        name: recipes.name,
        status: recipes.status,
        expectedBlocksPerMix: recipes.expectedBlocksPerMix,
        blockTypeId: recipes.blockTypeId,
        tipoBloque: blockTypes.name,
        tipoCodigo: blockTypes.code,
      })
      .from(recipes)
      .leftJoin(blockTypes, eq(recipes.blockTypeId, blockTypes.id))
      .where(and(isNull(recipes.deletedAt), ne(recipes.status, "retired")))
      .orderBy(recipes.name);

    const recetasDisponibles = todas.filter((r) => r.status === "validated");
    const enPrueba = todas.filter((r) => r.status !== "validated");

    const enCurso = await db
      .select()
      .from(batches)
      .where(isNull(batches.deletedAt))
      .orderBy(desc(batches.producedAt))
      .limit(1);

    /**
     * Lo que hay pedido, para que la planta no tenga que preguntar.
     *
     * Va acá y no en otra pantalla porque esta es la pantalla que se mira de
     * pie frente a la máquina. Si la orden vive en otro lado, lo que llega a
     * la planta sigue siendo un mensaje de WhatsApp.
     */
    const abiertas = await db
      .select({
        id: productionOrders.id,
        number: productionOrders.number,
        customerName: productionOrders.customerName,
        neededBy: productionOrders.neededBy,
        status: productionOrders.status,
        notes: productionOrders.notes,
      })
      .from(productionOrders)
      .where(
        and(
          inArray(productionOrders.status, ["pendiente", "en_proceso"]),
          isNull(productionOrders.deletedAt),
        ),
      );

    const renglones =
      abiertas.length === 0
        ? []
        : await db
            .select()
            .from(productionOrderLines)
            .where(inArray(productionOrderLines.orderId, abiertas.map((o) => o.id)));

    const hechos =
      abiertas.length === 0
        ? []
        : await db
            .select({
              orderId: batches.productionOrderId,
              blockTypeId: batches.blockTypeId,
              buenos: sql<number>`sum(${batches.blocksGood})::int`,
            })
            .from(batches)
            .where(
              and(inArray(batches.productionOrderId, abiertas.map((o) => o.id)), isNull(batches.deletedAt)),
            )
            .groupBy(batches.productionOrderId, batches.blockTypeId);
    const hecho = new Map(hechos.map((h) => [`${h.orderId}:${h.blockTypeId}`, Number(h.buenos) || 0]));

    const ordenes = abiertas
      .map((o) => {
        const suyos = renglones
          .filter((r) => r.orderId === o.id)
          .map((r) => ({
            blockTypeId: r.blockTypeId,
            description: r.description,
            quantity: r.quantity,
            producido: hecho.get(`${o.id}:${r.blockTypeId}`) ?? 0,
            falta: Math.max(0, r.quantity - (hecho.get(`${o.id}:${r.blockTypeId}`) ?? 0)),
          }));
        return { ...o, lines: suyos, falta: suyos.reduce((s, r) => s + r.falta, 0) };
      })
      .sort((a, b) => {
        const fa = a.neededBy ? new Date(a.neededBy).getTime() : Infinity;
        const fb = b.neededBy ? new Date(b.neededBy).getTime() : Infinity;
        return fa - fb;
      });

    return { recetas: recetasDisponibles, enPrueba, ultimoLote: enCurso[0] ?? null, ordenes };
  });

  // --- Arrancar de cero ----------------------------------------------------

  /**
   * Borra TODO el historial de producción: lotes, sus consumos congelados,
   * ensayos y registros de mantenimiento. Deja el catálogo, las recetas, los
   * precios, los puestos y los ajustes como están.
   *
   * Existe porque el sistema se entrega con un lote de ejemplo para que se
   * pueda ver funcionando, y ese lote no puede quedarse: el primer lote real
   * de la planta tiene que ser el número 1, no el 4, y su historial no puede
   * arrancar con una corrida que nunca ocurrió.
   *
   * Las recetas vuelven a «borrador». Una receta está validada porque un
   * ensayo la respalda; borrado el ensayo, el respaldo ya no existe y dejarla
   * validada sería exactamente la mentira que este módulo se niega a decir.
   *
   * No se puede deshacer, así que exige que se escriba la palabra.
   */
  app.post("/bloques/reiniciar-produccion", async (req, reply) => {
    const body = z.object({ confirmacion: z.string() }).parse(req.body);
    if (body.confirmacion !== "BORRAR") {
      return reply.code(400).send({
        error: "Falta la confirmación",
        detalle: "Para borrar el historial hay que escribir la palabra BORRAR.",
      });
    }

    const resumen = await db.transaction(async (tx) => {
      const lotes = await tx.select({ id: batches.id }).from(batches);
      const ensayos = await tx.select({ id: tests.id }).from(tests);

      // El orden importa: primero lo que apunta a los lotes.
      await tx.delete(tests);
      await tx.delete(batchLines);
      await tx.delete(maintenanceLogs);
      await tx.delete(batches);

      // Sin ensayos no hay receta respaldada.
      const devueltas = await tx
        .update(recipes)
        .set({ status: "draft", updatedAt: new Date() })
        .where(eq(recipes.status, "validated"))
        .returning({ id: recipes.id });

      // El correlativo también, o el primer lote real saldría con el número 5.
      await tx.update(counters).set({ value: 0 }).where(eq(counters.id, "batch"));

      await logActivity(tx, {
        userId: getUserId(req),
        entity: "batches",
        // No es una fila: es el historial entero.
        entityId: "reinicio-produccion",
        action: "delete",
        oldValues: {
          lotesBorrados: lotes.length,
          ensayosBorrados: ensayos.length,
          recetasDevueltasABorrador: devueltas.length,
        },
      });

      return {
        lotes: lotes.length,
        ensayos: ensayos.length,
        recetasDevueltasABorrador: devueltas.length,
      };
    });

    return resumen;
  });
}
