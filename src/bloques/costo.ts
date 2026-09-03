/**
 * Costo y rendimiento de la fabricacion de bloques.
 *
 * Funciones puras, sin base de datos: es la parte que tiene que estar bien
 * antes de que exista una sola pantalla.
 *
 * Convenciones, las mismas del modulo:
 *  - montos en CENTAVOS enteros
 *  - cantidades en MILESIMAS de la unidad de dosificacion
 *  - resistencia en MILESIMAS de MPa
 *
 * La regla que gobierna el archivo: ninguna funcion devuelve un costo por
 * bloque sin devolver junto a el en que estado esta la resistencia. Abaratar
 * un bloque es facil —se le baja el cemento— y sin la otra cifra al lado, el
 * sistema estaria premiando exactamente lo que no hay que hacer.
 */

export type Cents = number;
export type Milli = number;

export interface Material {
  id: string;
  nombre: string;
  /** Precio de UNA unidad de compra: la bolsa, el metro cubico. */
  precioCompraCents: Cents;
  /** Cuantas unidades de dosificacion rinde una unidad de compra, en milesimas. */
  contenidoPorCompraMilli: Milli;
}

export interface RenglonReceta {
  materialId: string;
  /** Cantidad por UNA mezcla, en milesimas de la unidad de dosificacion. */
  cantidadMilli: Milli;
}

export interface Receta {
  id: string;
  nombre: string;
  renglones: RenglonReceta[];
  /** Cuantos bloques se esperan de una mezcla. Estimacion hasta que haya lotes. */
  bloquesPorMezclaEsperados: number;
  estado: "borrador" | "validada" | "retirada";
}

export interface RenglonCosto {
  materialId: string;
  nombre: string;
  cantidadMilli: Milli;
  costoCents: Cents;
}

/**
 * Costo de UNA mezcla. Redondea al centavo en cada renglon, no al final:
 * lo que se suma es lo que se muestra, y la lista siempre cuadra con el total.
 */
export function costoPorMezcla(
  receta: Receta,
  materiales: Material[],
): {
  renglones: RenglonCosto[];
  totalCents: Cents;
  faltantes: string[];
  sinPrecio: string[];
} {
  const porId = new Map(materiales.map((m) => [m.id, m]));
  const renglones: RenglonCosto[] = [];
  const faltantes: string[] = [];
  const sinPrecio: string[] = [];

  for (const r of receta.renglones) {
    const m = porId.get(r.materialId);
    if (!m) {
      // Igual que en la cotizadora: un material que ya no existe NO se ignora
      // en silencio, porque el costo saldria mas barato de lo que es.
      faltantes.push(r.materialId);
      continue;
    }
    // Un precio en cero hace exactamente el mismo daño que un material
    // ausente: aporta cero al total y el bloque parece mas barato de lo que
    // es. Medido: quitarle el precio a la grava bajo el costo de $0.40 a
    // $0.30 —25% menos— sin una sola señal en pantalla. Un cero es "todavia
    // no lo he cargado", nunca "es gratis".
    if (m.precioCompraCents === 0) sinPrecio.push(m.id);

    const contenido = Math.max(1, m.contenidoPorCompraMilli);
    const costoCents = Math.round((r.cantidadMilli * m.precioCompraCents) / contenido);
    renglones.push({ materialId: m.id, nombre: m.nombre, cantidadMilli: r.cantidadMilli, costoCents });
  }

  return {
    renglones,
    totalCents: renglones.reduce((s, r) => s + r.costoCents, 0),
    faltantes,
    sinPrecio,
  };
}

/** Costo teorico por bloque: lo que la receta dice que deberia costar. */
export function costoTeoricoPorBloque(receta: Receta, materiales: Material[]) {
  const mezcla = costoPorMezcla(receta, materiales);
  const bloques = Math.max(1, receta.bloquesPorMezclaEsperados);
  return {
    ...mezcla,
    bloquesPorMezcla: bloques,
    costoPorBloqueCents: Math.round(mezcla.totalCents / bloques),
    /** Falso si algo aporta cero al total sin haberlo decidido nadie. */
    confiable: mezcla.faltantes.length === 0 && mezcla.sinPrecio.length === 0,
  };
}

// --- Lo que de verdad paso -------------------------------------------------

export interface Lote {
  id: string;
  numero: number;
  recetaId: string;
  mezclas: number;
  bloquesBuenos: number;
  bloquesRotos: number;
  /** Costo congelado con los precios del dia en que se produjo. */
  costoMaterialCents: Cents;
}

export interface Ensayo {
  loteId: string;
  edadDias: number;
  resistenciaMpaMilli: number;
  criterio: "neta" | "bruta";
}

export function resultadoDeLote(lote: Lote, receta: Receta) {
  const producidos = lote.bloquesBuenos + lote.bloquesRotos;
  const esperados = Math.max(1, receta.bloquesPorMezclaEsperados * Math.max(1, lote.mezclas));
  const vendibles = Math.max(1, lote.bloquesBuenos);

  return {
    bloquesEsperados: esperados,
    bloquesProducidos: producidos,
    bloquesBuenos: lote.bloquesBuenos,
    /** El costo se reparte solo entre los que se pueden vender. Los rotos se pagan igual. */
    costoRealPorBloqueCents: Math.round(lote.costoMaterialCents / vendibles),
    /** Cuanto de lo esperado salio vendible. Bajo 100% es plata que se fue. */
    rendimientoPct: Math.round((lote.bloquesBuenos / esperados) * 1000) / 10,
    desperdicioPct: producidos ? Math.round((lote.bloquesRotos / producidos) * 1000) / 10 : 0,
  };
}

/**
 * Las dos cifras juntas. Es la unica forma en que el sistema entrega un costo.
 *
 * Sin ensayo no dice "esta bien": dice que no se sabe. Esa es la diferencia
 * entre acompañar al fabricante y darle una garantia que nadie puede dar.
 */
export function fichaDeLote(
  lote: Lote,
  receta: Receta,
  materiales: Material[],
  ensayo: Ensayo | null,
  objetivoMpaMilli: number,
  objetivoCriterio: "neta" | "bruta",
) {
  const teorico = costoTeoricoPorBloque(receta, materiales);
  const real = resultadoDeLote(lote, receta);
  const brechaCents = real.costoRealPorBloqueCents - teorico.costoPorBloqueCents;

  let calidad:
    | { estado: "sin ensayar"; detalle: string }
    | { estado: "no comparable"; detalle: string }
    | { estado: "cumple" | "no cumple"; resistenciaMpaMilli: number; objetivoMpaMilli: number };

  if (!ensayo) {
    calidad = { estado: "sin ensayar", detalle: "El lote no tiene ensayo de resistencia." };
  } else if (ensayo.criterio !== objetivoCriterio) {
    // La trampa del area neta contra la bruta: en un bloque hueco la
    // diferencia pasa del doble. Antes de comparar, se avisa.
    calidad = {
      estado: "no comparable",
      detalle: `El ensayo esta en area ${ensayo.criterio} y el objetivo en area ${objetivoCriterio}.`,
    };
  } else {
    calidad = {
      estado: ensayo.resistenciaMpaMilli >= objetivoMpaMilli ? "cumple" : "no cumple",
      resistenciaMpaMilli: ensayo.resistenciaMpaMilli,
      objetivoMpaMilli,
    };
  }

  return { teorico, real, brechaCents, calidad, recetaEstado: receta.estado };
}

export const money = (c: Cents) => `$${(c / 100).toFixed(2)}`;
export const mpa = (m: number) => `${(m / 1000).toFixed(1)} MPa`;
