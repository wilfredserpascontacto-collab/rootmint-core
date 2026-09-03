/**
 * Indicadores de una mezcla: las cifras que se comparan contra los rangos.
 *
 * Lo que este archivo NO hace, y no va a hacer nunca: predecir la resistencia.
 * Ninguna proporcion dice cuanto va a aguantar un bloque. Estas cifras sirven
 * para avisar que la mezcla se aparto de lo habitual; quien dictamina es el
 * ensayo a los 28 dias.
 *
 * Convenciones: cantidades en MILESIMAS de la unidad de dosificacion, y las
 * relaciones tambien salen en milesimas (1:15.42 -> 15_420) para no meter
 * flotantes en la base ni en la API.
 */

export type TipoUnidad = "mass" | "volume" | "count";

export interface MaterialMedible {
  id: string;
  /** categoria de fabrica: "cementante", "agregado fino", "agregado grueso", "agua" */
  categoria: string | null;
  /** kg por metro cubico. Sin esto no se puede pasar de volumen a masa. */
  densidadKgM3: number | null;
  unidad: { kind: TipoUnidad; factorMilli: number } | null;
}

export interface RenglonMedible {
  materialId: string;
  cantidadMilli: number;
}

/**
 * Cantidad de un renglon expresada en kg y en litros.
 *
 * factorMilli dice cuanto vale 1 unidad de dosificacion en la base de su tipo
 * (kg para masa, litro para volumen), en milesimas. La conversion cruzada
 * entre masa y volumen necesita la densidad; sin ella devuelve null en el
 * lado que no se puede calcular, en vez de inventar un numero.
 */
export function medir(
  m: MaterialMedible,
  cantidadMilli: number,
): { kg: number | null; litros: number | null } {
  if (!m.unidad) return { kg: null, litros: null };
  const base = (cantidadMilli * m.unidad.factorMilli) / 1_000_000;
  const d = m.densidadKgM3;

  if (m.unidad.kind === "mass") {
    return { kg: base, litros: d ? (base / d) * 1000 : null };
  }
  if (m.unidad.kind === "volume") {
    return { kg: d ? (base / 1000) * d : null, litros: base };
  }
  return { kg: null, litros: null };
}

const esCementante = (c: string | null) => (c ?? "").toLowerCase().includes("cementante");
const esAgregado = (c: string | null) => (c ?? "").toLowerCase().includes("agregado");
const esAgua = (c: string | null) => (c ?? "").toLowerCase() === "agua";

export type Indicador =
  | { key: string; disponible: true; valorMilli: number }
  | { key: string; disponible: false; motivo: string };

/**
 * Las dos relaciones que salen de la receta misma.
 *
 * Las otras dos que el sistema vigila —modulo de finura y finos que pasan la
 * malla 50— NO se calculan aca a proposito: son propiedades del agregado que
 * solo se saben con un ensayo de granulometria. Devolverlas calculadas seria
 * inventarlas.
 */
export function indicadoresDeMezcla(
  renglones: RenglonMedible[],
  materiales: MaterialMedible[],
): Indicador[] {
  const porId = new Map(materiales.map((m) => [m.id, m]));

  let volCementoL = 0;
  let masaCementoKg = 0;
  let volAgregadoL = 0;
  let masaAguaKg = 0;
  let faltaDensidadCemento = false;
  let faltaVolumenAgregado = false;

  for (const r of renglones) {
    const m = porId.get(r.materialId);
    if (!m) continue;
    const { kg, litros } = medir(m, r.cantidadMilli);

    if (esCementante(m.categoria)) {
      if (kg !== null) masaCementoKg += kg;
      if (litros !== null) volCementoL += litros;
      else faltaDensidadCemento = true;
    } else if (esAgregado(m.categoria)) {
      if (litros !== null) volAgregadoL += litros;
      else faltaVolumenAgregado = true;
    } else if (esAgua(m.categoria)) {
      if (kg !== null) masaAguaKg += kg;
    }
  }

  const out: Indicador[] = [];

  if (volCementoL > 0 && volAgregadoL > 0 && !faltaDensidadCemento && !faltaVolumenAgregado) {
    out.push({
      key: "rango.cemento_agregado",
      disponible: true,
      valorMilli: Math.round((volAgregadoL / volCementoL) * 1000),
    });
  } else {
    out.push({
      key: "rango.cemento_agregado",
      disponible: false,
      motivo: volCementoL <= 0
        ? "La receta no tiene cementante con densidad cargada."
        : volAgregadoL <= 0
          ? "La receta no tiene agregado."
          : "Falta la densidad de algún material para pasar a volumen.",
    });
  }

  if (masaCementoKg > 0 && masaAguaKg > 0) {
    out.push({
      key: "rango.agua_cemento",
      disponible: true,
      valorMilli: Math.round((masaAguaKg / masaCementoKg) * 1000),
    });
  } else {
    out.push({
      key: "rango.agua_cemento",
      disponible: false,
      motivo: masaAguaKg <= 0 ? "La receta no lleva agua cargada." : "Falta el cementante.",
    });
  }

  for (const key of ["rango.modulo_finura", "rango.finos_malla50"]) {
    out.push({
      key,
      disponible: false,
      motivo: "Es una propiedad del agregado: sale de un ensayo de granulometría, no de la receta.",
    });
  }

  return out;
}
