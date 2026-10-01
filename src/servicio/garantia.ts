import { diasEntre, sumarDias } from "../lib/fechas.js";

/**
 * Lo que dice cada garantia, y lo que dice una instalacion con todas las suyas.
 *
 * Nada de esto se guarda: «en garantia», «vencida», «quedan 40 dias» se
 * CALCULAN de las fechas y de hoy, cada vez. Un estado guardado se
 * desincroniza el dia que alguien se olvida de actualizarlo, y la pregunta
 * que contesta —¿esta llamada la cobro o no?— es justo la que no admite una
 * respuesta vieja.
 */

export type GarantiaBasica = {
  /** Primer dia que cubre. */
  startsAt: string;
  /** Ultimo dia que cubre, INCLUSIVE: hasta ese dia a la noche sigue en garantia. */
  endsAt: string;
  annulledAt: unknown;
};

export type EstadoDeUna = "vigente" | "vencida" | "futura" | "anulada";

export function estadoDeUna(g: GarantiaBasica, hoy: string): EstadoDeUna {
  if (g.annulledAt) return "anulada";
  if (g.endsAt < hoy) return "vencida";
  if (g.startsAt > hoy) return "futura";
  return "vigente";
}

export type EstadoDeInstalacion =
  | "en_garantia"
  | "vencida"
  | "futura"
  | "sin_garantia"
  | "sin_fecha";

export type ResumenGarantia = {
  estado: EstadoDeInstalacion;
  /** Hasta cuando esta cubierta (ultimo dia), si lo esta. */
  hasta: string | null;
  /** Dias que faltan para `hasta`; 0 es «vence hoy». */
  diasRestantes: number | null;
  /** Cuando dejo de estar cubierta, si ya vencio. */
  vencioEl: string | null;
  /** Hace cuantos dias vencio. */
  haceDias: number | null;
  /** Desde cuando empieza, si todavia no empezo. */
  empiezaEl: string | null;
};

const VACIO: ResumenGarantia = {
  estado: "sin_garantia",
  hasta: null,
  diasRestantes: null,
  vencioEl: null,
  haceDias: null,
  empiezaEl: null,
};

/**
 * ¿Esta instalacion esta en garantia hoy?
 *
 * Las garantias de una misma instalacion se juntan en tramos: si una termina
 * el 14 y la siguiente empieza el 15, la cobertura es continua y el «hasta
 * cuando» es el final de la segunda, no el de la primera. Es lo que pasa
 * cuando se vende una extension encima de la garantia del trabajo.
 *
 * Una instalacion sin fecha de entrega y sin ninguna garantia cargada NO es
 * «sin garantia»: es «no se sabe», y el sistema tiene que decirlo asi en vez
 * de contestar con seguridad algo que nadie cargo.
 */
export function resumenDeInstalacion(
  deliveredAt: string | null,
  garantias: GarantiaBasica[],
  hoy: string,
): ResumenGarantia {
  const vivas = garantias.filter((g) => !g.annulledAt);
  if (vivas.length === 0) {
    return { ...VACIO, estado: deliveredAt ? "sin_garantia" : "sin_fecha" };
  }

  // Tramos continuos: se ordena por inicio y se junta lo que se toca o se solapa.
  const orden = [...vivas].sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
  const tramos: { desde: string; hasta: string }[] = [];
  for (const g of orden) {
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && g.startsAt <= sumarDias(ultimo.hasta, 1)) {
      if (g.endsAt > ultimo.hasta) ultimo.hasta = g.endsAt;
    } else {
      tramos.push({ desde: g.startsAt, hasta: g.endsAt });
    }
  }

  const hoyEn = tramos.find((t) => t.desde <= hoy && hoy <= t.hasta);
  if (hoyEn) {
    return {
      ...VACIO,
      estado: "en_garantia",
      hasta: hoyEn.hasta,
      diasRestantes: diasEntre(hoy, hoyEn.hasta),
    };
  }

  // Hoy no esta cubierta. Lo que importa para cobrar es lo mas reciente que vencio.
  const vencidos = tramos.filter((t) => t.hasta < hoy);
  if (vencidos.length > 0) {
    const ultimo = vencidos[vencidos.length - 1]!;
    return { ...VACIO, estado: "vencida", vencioEl: ultimo.hasta, haceDias: diasEntre(ultimo.hasta, hoy) };
  }

  const proximo = tramos.find((t) => t.desde > hoy)!;
  return { ...VACIO, estado: "futura", empiezaEl: proximo.desde };
}

/** Los cuatro textos que la ley exige en el documento de garantia (Art. 33). */
export const TEXTOS_ART33 = [
  ["conditions", "las condiciones, formas y plazos"],
  ["customerDuties", "las responsabilidades del consumidor"],
  ["howToClaim", "cómo hacerla efectiva"],
  ["issuedBy", "quién la extiende y la cumple"],
] as const;

/** Que le falta a una garantia para que su certificado cumpla. Vacio: nada. */
export function faltanTextos(g: Record<"conditions" | "customerDuties" | "howToClaim" | "issuedBy", string | null>) {
  return TEXTOS_ART33.filter(([campo]) => !(g[campo] ?? "").trim()).map(([, nombre]) => nombre);
}
