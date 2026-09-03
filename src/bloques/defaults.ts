/**
 * Valores de fabrica del modulo de bloques.
 *
 * Viven en el codigo, NO en la base del cliente. La base solo guarda lo que el
 * cliente cambio (tabla settings). El sistema resuelve cada valor con
 * resolver(): ajuste del cliente ?? valor de fabrica.
 *
 * Asi lo que el cliente toco queda intocable para siempre, y lo que nunca toco
 * puede recibir mejoras nuestras sin pisarle nada.
 *
 * Cada rango trae ademas su referencia de norma. Esa referencia NO es editable
 * y no desaparece de la pantalla: el rango que manda es el del cliente, pero la
 * norma queda dibujada detras para que apartarse de ella sea una decision suya
 * y no un descuido.
 */

export type ValorAjustable<T> = {
  /** Lo que trae el sistema si el cliente no toca nada. */
  fabrica: T;
  etiqueta: string;
  ayuda?: string;
};

export type Rango = {
  min: number;
  max: number;
};

export type RangoAjustable = ValorAjustable<Rango> & {
  unidad: string;
  /** Inamovible. Se dibuja detras del rango del cliente, con su origen. */
  norma: { min?: number; max?: number; valor?: number; fuente: string };
};

// --- Unidades de dosificacion ----------------------------------------------
// factorMilli: cuanto vale 1 de esta unidad en la base de su tipo, en
// milesimas. Base de masa = kg, base de volumen = litro, base de conteo = pieza.

export const UNIDADES_FABRICA = [
  { abbreviation: "kg", name: "Kilogramo", kind: "mass", factorMilli: 1_000 },
  { abbreviation: "qq", name: "Quintal", kind: "mass", factorMilli: 45_360 },
  { abbreviation: "bolsa", name: "Bolsa de cemento (42.5 kg)", kind: "mass", factorMilli: 42_500 },
  { abbreviation: "L", name: "Litro", kind: "volume", factorMilli: 1_000 },
  { abbreviation: "m3", name: "Metro cubico", kind: "volume", factorMilli: 1_000_000 },
  { abbreviation: "carretilla", name: "Carretilla (~65 L)", kind: "volume", factorMilli: 65_000 },
  { abbreviation: "balde", name: "Balde (~19 L)", kind: "volume", factorMilli: 19_000 },
  { abbreviation: "palada", name: "Palada (~3 L)", kind: "volume", factorMilli: 3_000 },
  { abbreviation: "u", name: "Pieza", kind: "count", factorMilli: 1_000 },
] as const;

// --- Materia prima ---------------------------------------------------------
// Los precios arrancan en cero a proposito: son de este cliente y de esta
// semana, y ponerle un precio inventado es peor que dejarlo vacio.

export const MATERIALES_FABRICA = [
  { code: "cemento", name: "Cemento gris", category: "cementante", purchaseUnit: "bolsa de 42.5 kg", dosing: "bolsa", contentPerPurchaseMilli: 1_000, bulkDensityKgM3: 1_440 },
  { code: "arena", name: "Arena", category: "agregado fino", purchaseUnit: "metro cubico", dosing: "carretilla", contentPerPurchaseMilli: 15_385, bulkDensityKgM3: 1_600 },
  { code: "grava", name: "Grava / chispa", category: "agregado grueso", purchaseUnit: "metro cubico", dosing: "carretilla", contentPerPurchaseMilli: 15_385, bulkDensityKgM3: 1_500 },
  { code: "agua", name: "Agua", category: "agua", purchaseUnit: "metro cubico", dosing: "L", contentPerPurchaseMilli: 1_000_000, bulkDensityKgM3: 1_000 },
] as const;

// --- Tipos de bloque -------------------------------------------------------
// Las medidas son las que se usan en Centroamerica. Las areas netas son una
// estimacion a partir de dos huecos rectangulares: el cliente las corrige con
// las de sus moldes, que es el dato que vale.

export const TIPOS_BLOQUE_FABRICA = [
  { code: "B10", name: "Bloque 10 x 20 x 40", lengthMm: 400, heightMm: 200, widthMm: 100, holes: [{ count: 2, lengthMm: 120, widthMm: 55 }] },
  { code: "B15", name: "Bloque 15 x 20 x 40", lengthMm: 400, heightMm: 200, widthMm: 150, holes: [{ count: 2, lengthMm: 120, widthMm: 95 }] },
  { code: "B20", name: "Bloque 20 x 20 x 40", lengthMm: 400, heightMm: 200, widthMm: 200, holes: [{ count: 2, lengthMm: 120, widthMm: 140 }] },
] as const;

/** Area bruta y neta a partir de las medidas. Ambas quedan editables despues. */
export function areasDe(t: {
  lengthMm: number;
  widthMm: number;
  holes?: readonly { count: number; lengthMm: number; widthMm: number }[];
}) {
  const bruta = t.lengthMm * t.widthMm;
  const huecos = (t.holes ?? []).reduce(
    (suma, h) => suma + h.count * h.lengthMm * h.widthMm,
    0,
  );
  return { grossAreaMm2: bruta, netAreaMm2: Math.max(1, bruta - huecos) };
}

// --- Rangos de advertencia -------------------------------------------------

export const RANGOS_FABRICA: Record<string, RangoAjustable> = {
  "rango.modulo_finura": {
    etiqueta: "Modulo de finura del agregado",
    unidad: "",
    fabrica: { min: 3.5, max: 4.17 },
    norma: { min: 3.5, max: 4.17, fuente: "Columbia Machine, granulometria para bloque" },
    ayuda: "Fuera de este rango la textura y la compactacion se degradan.",
  },
  "rango.finos_malla50": {
    etiqueta: "Finos que pasan la malla No. 50",
    unidad: "%",
    fabrica: { min: 12, max: 15 },
    norma: { min: 12, max: 15, fuente: "Columbia Machine, % del volumen del agregado" },
    ayuda: "Con menos finos el bloque se desgrana; con mas, pierde resistencia.",
  },
  "rango.cemento_agregado": {
    etiqueta: "Proporcion cemento : agregado",
    unidad: "1 : x",
    fabrica: { min: 6, max: 9 },
    norma: { min: 6, max: 9, fuente: "Practica habitual; NIS recomienda 1:8 para bloque hueco" },
    ayuda: "Bajar el cemento abarata el bloque y le quita resistencia. Las dos cosas a la vez.",
  },
  "rango.agua_cemento": {
    etiqueta: "Relacion agua : cemento",
    unidad: "",
    fabrica: { min: 0.35, max: 0.5 },
    norma: { valor: 0.5, fuente: "Optimo citado para bloque; el prensado en seco baja mas" },
    ayuda: "El bloque prensado va casi seco. De mas agua sale panzon y de menos no compacta.",
  },
};

// --- Proceso ---------------------------------------------------------------

export const PROCESO_FABRICA = {
  "proceso.dias_curado": {
    etiqueta: "Dias minimos de curado",
    fabrica: 14,
    ayuda: "Antes de este plazo el bloque todavia no llego a su resistencia.",
  } as ValorAjustable<number>,
  "proceso.edad_ensayo": {
    etiqueta: "Edad del bloque al ensayar",
    fabrica: 28,
    ayuda: "Es la edad en la que las normas fijan la resistencia caracteristica.",
  } as ValorAjustable<number>,
  "proceso.resistencia_objetivo_mpa_milli": {
    etiqueta: "Resistencia objetivo por defecto",
    fabrica: 13_800,
    ayuda: "13.8 MPa sobre area NETA es el minimo de ASTM C90 para bloque de carga.",
  } as ValorAjustable<number>,
};

// --- Resolucion ------------------------------------------------------------

export type FilaAjuste = { key: string; value: unknown };

/**
 * Arma el lector de valores: el ajuste del cliente si existe, y si no el de
 * fabrica. Recibe las filas de la tabla settings ya leidas.
 */
export function resolver(ajustes: FilaAjuste[]) {
  const puestos = new Map(ajustes.map((a) => [a.key, a.value]));

  return {
    rango(key: keyof typeof RANGOS_FABRICA | string): Rango & { esDelCliente: boolean } {
      const def = RANGOS_FABRICA[key];
      if (!def) throw new Error(`Rango desconocido: ${key}`);
      const puesto = puestos.get(key) as Rango | undefined;
      return { ...(puesto ?? def.fabrica), esDelCliente: puesto !== undefined };
    },
    numero(key: string): number & {} {
      const def = PROCESO_FABRICA[key as keyof typeof PROCESO_FABRICA];
      if (!def) throw new Error(`Ajuste desconocido: ${key}`);
      const puesto = puestos.get(key);
      return typeof puesto === "number" ? puesto : def.fabrica;
    },
    /** true si el valor lo puso el cliente. Sirve para marcarlo en pantalla. */
    esDelCliente(key: string) {
      return puestos.has(key);
    },
  };
}

/** Compara un valor contra su rango vigente. Es toda la "prediccion de errores". */
export function evaluar(valor: number, rango: Rango) {
  if (valor < rango.min) return { estado: "bajo" as const, rango };
  if (valor > rango.max) return { estado: "alto" as const, rango };
  return { estado: "dentro" as const, rango };
}
