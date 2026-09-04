/**
 * El puente entre la base de datos y el modelo de costo.
 *
 * costo.ts e indicadores.ts son funciones puras y no saben que existe
 * Postgres. Este archivo lee las filas, las traduce a esas formas, y devuelve
 * lo que las pantallas necesitan.
 */

import { eq, inArray, desc, isNull, and } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  settings,
  units,
  materials,
  blockTypes,
  recipes,
  recipeLines,
  batches,
  batchLines,
  tests,
} from "../db/schema-bloques.js";
import {
  costoTeoricoPorBloque,
  fichaDeLote,
  type Material as MaterialCosto,
  type Receta as RecetaCosto,
} from "./costo.js";
import {
  indicadoresDeMezcla,
  type MaterialMedible,
  type Indicador,
} from "./indicadores.js";
import {
  resolver,
  evaluar,
  RANGOS_FABRICA,
  PROCESO_FABRICA,
  type Rango,
} from "./defaults.js";

const ESTADO_RECETA = {
  draft: "borrador",
  validated: "validada",
  retired: "retirada",
} as const;

export async function leerResolver() {
  const filas = await db.select().from(settings);
  return resolver(filas.map((f) => ({ key: f.key, value: f.value })));
}

/** Materiales en las dos formas que necesitan los calculos, de una sola lectura. */
export async function leerMateriales(ids?: string[]) {
  const base = db
    .select({
      id: materials.id,
      code: materials.code,
      name: materials.name,
      category: materials.category,
      purchaseUnit: materials.purchaseUnit,
      purchasePriceCents: materials.purchasePriceCents,
      contentPerPurchaseMilli: materials.contentPerPurchaseMilli,
      bulkDensityKgM3: materials.bulkDensityKgM3,
      unitKind: units.kind,
      unitFactorMilli: units.factorMilli,
      unitAbbreviation: units.abbreviation,
    })
    .from(materials)
    .leftJoin(units, eq(materials.dosingUnitId, units.id));

  const filas = ids && ids.length
    ? await base.where(inArray(materials.id, ids))
    : await base;

  const paraCosto: MaterialCosto[] = filas.map((m) => ({
    id: m.id,
    nombre: m.name,
    precioCompraCents: m.purchasePriceCents,
    contenidoPorCompraMilli: m.contentPerPurchaseMilli,
  }));

  const paraMedir: MaterialMedible[] = filas.map((m) => ({
    id: m.id,
    categoria: m.category,
    densidadKgM3: m.bulkDensityKgM3,
    unidad:
      m.unitKind && m.unitFactorMilli !== null
        ? { kind: m.unitKind, factorMilli: m.unitFactorMilli }
        : null,
  }));

  return { filas, paraCosto, paraMedir };
}

/**
 * Compara cada indicador contra el rango vigente y arrastra la norma.
 *
 * La norma va SIEMPRE en la respuesta, aunque el cliente haya movido el rango.
 * Es la mitad del argumento: el rango del cliente manda sobre el aviso, y la
 * norma queda visible para que apartarse de ella sea una decision y no un
 * descuido.
 */
export function evaluarIndicadores(
  indicadores: Indicador[],
  res: ReturnType<typeof resolver>,
) {
  return indicadores.map((ind) => {
    const def = RANGOS_FABRICA[ind.key];
    const rango: Rango & { esDelCliente: boolean } = res.rango(ind.key);
    const comun = {
      key: ind.key,
      etiqueta: def?.etiqueta ?? ind.key,
      unidad: def?.unidad ?? "",
      ayuda: def?.ayuda ?? null,
      rango: { min: rango.min, max: rango.max, esDelCliente: rango.esDelCliente },
      norma: def?.norma ?? null,
    };

    if (!ind.disponible) {
      return { ...comun, disponible: false as const, motivo: ind.motivo };
    }

    const valor = ind.valorMilli / 1000;
    const { estado } = evaluar(valor, rango);
    /** Si el rango del cliente es mas ancho que la norma, el aviso calla pero el dato queda. */
    const pasaLaNorma =
      def?.norma?.max !== undefined && valor > def.norma.max
        ? "arriba"
        : def?.norma?.min !== undefined && valor < def.norma.min
          ? "abajo"
          : null;

    return {
      ...comun,
      disponible: true as const,
      valorMilli: ind.valorMilli,
      estado,
      pasaLaNorma,
    };
  });
}

export async function recetaConCosto(recipeId: string) {
  const [receta] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
  if (!receta) return null;

  const lineas = await db
    .select({
      id: recipeLines.id,
      materialId: recipeLines.materialId,
      quantityMilli: recipeLines.quantityMilli,
      displayOrder: recipeLines.displayOrder,
      unitAbbreviation: units.abbreviation,
    })
    .from(recipeLines)
    .leftJoin(units, eq(recipeLines.unitId, units.id))
    .where(eq(recipeLines.recipeId, recipeId))
    .orderBy(recipeLines.displayOrder);

  const { filas, paraCosto, paraMedir } = await leerMateriales();
  const porId = new Map(filas.map((m) => [m.id, m]));

  const recetaCosto: RecetaCosto = {
    id: receta.id,
    nombre: receta.name,
    renglones: lineas.map((l) => ({ materialId: l.materialId, cantidadMilli: l.quantityMilli })),
    bloquesPorMezclaEsperados: receta.expectedBlocksPerMix ?? 1,
    estado: ESTADO_RECETA[receta.status],
  };

  const teorico = costoTeoricoPorBloque(recetaCosto, paraCosto);
  const res = await leerResolver();
  const advertencias = evaluarIndicadores(
    indicadoresDeMezcla(recetaCosto.renglones, paraMedir),
    res,
  );

  const [tipo] = await db.select().from(blockTypes).where(eq(blockTypes.id, receta.blockTypeId));

  return {
    receta: { ...receta, estadoEs: ESTADO_RECETA[receta.status] },
    tipoBloque: tipo ?? null,
    renglones: lineas.map((l) => {
      const m = porId.get(l.materialId);
      const costo = teorico.renglones.find((r) => r.materialId === l.materialId);
      return {
        id: l.id,
        materialId: l.materialId,
        nombre: m?.name ?? "Material eliminado del catálogo",
        cantidadMilli: l.quantityMilli,
        unidad: l.unitAbbreviation ?? m?.unitAbbreviation ?? "",
        precioCompraCents: m?.purchasePriceCents ?? 0,
        unidadCompra: m?.purchaseUnit ?? "",
        costoCents: costo?.costoCents ?? 0,
        sinPrecio: (m?.purchasePriceCents ?? 0) === 0,
      };
    }),
    totalMezclaCents: teorico.totalCents,
    bloquesPorMezcla: teorico.bloquesPorMezcla,
    costoPorBloqueCents: teorico.costoPorBloqueCents,
    confiable: teorico.confiable,
    faltantes: teorico.faltantes,
    sinPrecio: teorico.sinPrecio,
    advertencias,
  };
}

/**
 * La ficha del lote: costo y resistencia, juntos y en la misma respuesta.
 *
 * No existe un endpoint que devuelva solo el costo de un lote. Es a proposito.
 */
export async function fichaDelLote(batchId: string) {
  const [lote] = await db.select().from(batches).where(eq(batches.id, batchId));
  if (!lote) return null;

  const [receta] = await db.select().from(recipes).where(eq(recipes.id, lote.recipeId));
  const [tipo] = await db.select().from(blockTypes).where(eq(blockTypes.id, lote.blockTypeId));
  if (!receta || !tipo) return null;

  const lineasLote = await db
    .select()
    .from(batchLines)
    .where(eq(batchLines.batchId, batchId));

  const lineasReceta = await db
    .select()
    .from(recipeLines)
    .where(eq(recipeLines.recipeId, receta.id))
    .orderBy(recipeLines.displayOrder);

  const { paraCosto } = await leerMateriales();

  const recetaCosto: RecetaCosto = {
    id: receta.id,
    nombre: receta.name,
    renglones: lineasReceta.map((l) => ({
      materialId: l.materialId,
      cantidadMilli: l.quantityMilli,
    })),
    bloquesPorMezclaEsperados: receta.expectedBlocksPerMix ?? 1,
    estado: ESTADO_RECETA[receta.status],
  };

  /** El ensayo mas reciente del lote. Si no hay, la ficha lo dice. */
  const [ensayo] = await db
    .select()
    .from(tests)
    .where(eq(tests.batchId, batchId))
    .orderBy(desc(tests.testedAt))
    .limit(1);

  const res = await leerResolver();
  const objetivoMpaMilli =
    tipo.targetStrengthMpaMilli ?? res.numero("proceso.resistencia_objetivo_mpa_milli");
  const objetivoCriterio: "neta" | "bruta" =
    (tipo.targetStrengthBasis ?? "net") === "net" ? "neta" : "bruta";

  const ficha = fichaDeLote(
    {
      id: lote.id,
      numero: lote.number,
      recetaId: lote.recipeId,
      mezclas: lote.mixes,
      bloquesBuenos: lote.blocksGood,
      bloquesRotos: lote.blocksBroken,
      costoMaterialCents: lote.materialCostCents,
    },
    recetaCosto,
    paraCosto,
    ensayo
      ? {
          loteId: batchId,
          edadDias: ensayo.ageDays,
          resistenciaMpaMilli: ensayo.strengthMpaMilli,
          criterio: ensayo.basis === "net" ? "neta" : "bruta",
        }
      : null,
    objetivoMpaMilli,
    objetivoCriterio,
  );

  /**
   * Lo que costo de mas: los bloques que se rompieron, a costo teorico.
   * Es la cifra que el fabricante puede accionar; la brecha por bloque sola
   * no dice cuanta plata se fue.
   */
  const perdidaRotosCents = Math.round(
    lote.blocksBroken * (ficha.teorico.totalCents / Math.max(1, ficha.teorico.bloquesPorMezcla)),
  );

  return {
    lote: {
      id: lote.id,
      numero: lote.number,
      producidoEl: lote.producedAt,
      mezclas: lote.mixes,
      bloquesBuenos: lote.blocksGood,
      bloquesRotos: lote.blocksBroken,
      origenConteo: lote.countSource,
      ciclosMaquina: lote.machineCycles,
      mantenimientoVencido: lote.maintenanceOverdue ?? [],
      notas: lote.notes,
    },
    receta: { id: receta.id, nombre: receta.name, estado: ESTADO_RECETA[receta.status] },
    tipoBloque: { id: tipo.id, codigo: tipo.code, nombre: tipo.name },
    ...ficha,
    perdidaRotosCents,
    consumo: lineasLote.map((l) => ({
      descripcion: l.description,
      cantidadMilli: l.quantityMilli,
      unidad: l.unitAbbreviation,
      precioUnitarioCents: l.unitPriceCents,
      subtotalCents: l.subtotalCents,
    })),
    ensayo: ensayo
      ? {
          id: ensayo.id,
          ensayadoEl: ensayo.testedAt,
          edadDias: ensayo.ageDays,
          probetas: ensayo.specimens,
          resistenciaMpaMilli: ensayo.strengthMpaMilli,
          criterio: ensayo.basis,
          fuente: ensayo.source,
          origenLectura: ensayo.readingSource,
        }
      : null,
    objetivo: { mpaMilli: objetivoMpaMilli, criterio: objetivoCriterio },
  };
}

/** Los ajustes con su valor vigente, su origen y la norma detrás. */
export async function ajustesResueltos() {
  const res = await leerResolver();

  const rangos = Object.entries(RANGOS_FABRICA).map(([key, def]) => {
    const r = res.rango(key);
    return {
      key,
      tipo: "rango" as const,
      etiqueta: def.etiqueta,
      unidad: def.unidad,
      ayuda: def.ayuda ?? null,
      fabrica: def.fabrica,
      valor: { min: r.min, max: r.max },
      esDelCliente: r.esDelCliente,
      norma: def.norma,
    };
  });

  const numeros = Object.entries(PROCESO_FABRICA).map(([key, def]) => ({
    key,
    tipo: "numero" as const,
    etiqueta: def.etiqueta,
    ayuda: def.ayuda ?? null,
    fabrica: def.fabrica,
    valor: res.numero(key),
    esDelCliente: res.esDelCliente(key),
    norma: null,
  }));

  return [...rangos, ...numeros];
}

/**
 * La lista de lotes.
 *
 * Devuelve los ESPERADOS y el RENDIMIENTO, no solo los buenos y los rotos.
 *
 * Sin esos dos, la lista muestra las partes y esconde el resultado: 470
 * bloques buenos no dice nada hasta saber si se esperaban 500 o 600, y al
 * lado de un lote de 57 el de 470 parece el mejor de los dos aunque haya
 * rendido mucho peor. Un lote es bueno o malo por la proporción, y la
 * proporción es justo lo que no se podía ver sin entrar a cada uno.
 */
export async function lotesRecientes(limite = 50) {
  const filas = await db
    .select({
      id: batches.id,
      numero: batches.number,
      producidoEl: batches.producedAt,
      mezclas: batches.mixes,
      bloquesBuenos: batches.blocksGood,
      bloquesRotos: batches.blocksBroken,
      costoMaterialCents: batches.materialCostCents,
      recetaNombre: recipes.name,
      tipoBloque: blockTypes.code,
      porMezcla: recipes.expectedBlocksPerMix,
    })
    .from(batches)
    .leftJoin(recipes, eq(batches.recipeId, recipes.id))
    .leftJoin(blockTypes, eq(batches.blockTypeId, blockTypes.id))
    .where(isNull(batches.deletedAt))
    .orderBy(desc(batches.producedAt))
    .limit(limite);

  return filas.map(({ porMezcla, ...f }) => {
    /**
     * Sin bloques por mezcla en la receta no hay contra qué comparar, y
     * entonces el rendimiento se devuelve nulo en vez de cero: cero se
     * leería como "rindió pésimo" cuando lo cierto es "no se sabe".
     */
    const esperados = porMezcla ? porMezcla * f.mezclas : null;
    return {
      ...f,
      bloquesEsperados: esperados,
      rendimientoPct:
        esperados && esperados > 0
          ? Math.round((f.bloquesBuenos / esperados) * 1000) / 10
          : null,
    };
  });
}

export { ESTADO_RECETA };
