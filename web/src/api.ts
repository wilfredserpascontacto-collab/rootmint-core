/**
 * Cliente de la API.
 *
 * La interfaz se sirve desde el mismo origen que la API, así que las rutas
 * van relativas: no hay una URL base que configurar por ambiente ni que se
 * pueda quedar apuntando al lugar equivocado el día de una demostración.
 */

export class ErrorApi extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
    readonly detalle?: unknown,
  ) {
    super(mensaje);
  }
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  const r = await fetch(ruta, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (r.status === 204) return undefined as T;
  const cuerpo = await r.json().catch(() => null);
  if (!r.ok) {
    const msg =
      (cuerpo && typeof cuerpo === "object" && "error" in cuerpo
        ? String((cuerpo as { error: unknown }).error)
        : null) ?? `Error ${r.status}`;
    const det =
      cuerpo && typeof cuerpo === "object" && "detalle" in cuerpo
        ? (cuerpo as { detalle: unknown }).detalle
        : undefined;
    throw new ErrorApi(r.status, msg, det);
  }
  return cuerpo as T;
}

export const api = {
  get: <T,>(ruta: string) => pedir<T>(ruta),
  post: <T,>(ruta: string, cuerpo?: unknown) =>
    pedir<T>(ruta, { method: "POST", body: JSON.stringify(cuerpo ?? {}) }),
  patch: <T,>(ruta: string, cuerpo: unknown) =>
    pedir<T>(ruta, { method: "PATCH", body: JSON.stringify(cuerpo) }),
  put: <T,>(ruta: string, cuerpo: unknown) =>
    pedir<T>(ruta, { method: "PUT", body: JSON.stringify(cuerpo) }),
  del: (ruta: string) => pedir<void>(ruta, { method: "DELETE" }),
};

// --- Formato ---------------------------------------------------------------
// Los montos viajan en centavos enteros y las cantidades en milésimas. La
// conversión a texto ocurre acá y en ningún otro lado.

export const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("es-SV", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Sin decimales cuando la cantidad es entera: "10 bolsas", no "10.000 bolsas". */
export const milli = (m: number) => {
  const v = m / 1000;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, "");
};

export const mpa = (m: number) => (m / 1000).toFixed(1);

/**
 * "10 bolsas", no "10 bolsa".
 *
 * Las abreviaturas se guardan en singular. Pluraliza solo las que son palabras
 * terminadas en vocal (bolsa, carretilla, balde, palada) y deja intactas las
 * unidades de símbolo: L, kg, m3, qq, u.
 */
export const unidad = (cantidadMilli: number, abrev: string) => {
  const n = cantidadMilli / 1000;
  if (n === 1 || abrev.length <= 2) return abrev;
  return /[aeiou]$/i.test(abrev) ? `${abrev}s` : abrev;
};

/**
 * Precio por unidad con la precision que haga falta.
 *
 * El agua sale a 0.15 centavos el litro: redondeada al centavo se imprime
 * "$0.00", que se lee como gratis. Cuando el monto no es cero pero redondea
 * a cero, se muestran mas decimales en vez de mentir.
 */
export const moneyFino = (cents: number) => {
  if (cents === 0) return "$0.00";
  if (Math.abs(cents) < 1) return `$${(cents / 100).toFixed(4)}`;
  return money(Math.round(cents));
};

/** Cantidad y unidad juntas, ya pluralizada: "40 carretillas". */
export const cantidad = (cantidadMilli: number, abrev: string) =>
  `${milli(cantidadMilli)} ${unidad(cantidadMilli, abrev)}`;

export const fecha = (iso: string | Date | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("es-SV", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "—";

// --- Tipos que devuelve la API ---------------------------------------------

export type Estado = "dentro" | "bajo" | "alto";

export interface Advertencia {
  key: string;
  etiqueta: string;
  unidad: string;
  ayuda: string | null;
  rango: { min: number; max: number; esDelCliente: boolean };
  norma: { min?: number; max?: number; valor?: number; fuente: string } | null;
  disponible: boolean;
  motivo?: string;
  valorMilli?: number;
  estado?: Estado;
  pasaLaNorma?: "arriba" | "abajo" | null;
}

export interface RenglonReceta {
  id: string;
  materialId: string;
  nombre: string;
  cantidadMilli: number;
  unidad: string;
  precioCompraCents: number;
  unidadCompra: string;
  costoCents: number;
  sinPrecio: boolean;
}

export interface RecetaDetalle {
  receta: { id: string; code: string; name: string; estadoEs: string; expectedBlocksPerMix: number | null; notes: string | null };
  tipoBloque: { id: string; code: string; name: string } | null;
  renglones: RenglonReceta[];
  totalMezclaCents: number;
  bloquesPorMezcla: number;
  costoPorBloqueCents: number;
  confiable: boolean;
  faltantes: string[];
  sinPrecio: string[];
  advertencias: Advertencia[];
}

export type Calidad =
  | { estado: "sin ensayar"; detalle: string }
  | { estado: "no comparable"; detalle: string }
  | { estado: "cumple" | "no cumple"; resistenciaMpaMilli: number; objetivoMpaMilli: number };

export interface Ficha {
  lote: {
    id: string;
    numero: number;
    producidoEl: string;
    mezclas: number;
    bloquesBuenos: number;
    bloquesRotos: number;
    origenConteo: "person" | "machine";
    ciclosMaquina: number | null;
    mantenimientoVencido: { taskId: string; nombre: string; vencidaPor: number; unidad: "mezclas" | "lotes" }[];
    notas: string | null;
  };
  receta: { id: string; nombre: string; estado: string };
  tipoBloque: { id: string; codigo: string; nombre: string };
  teorico: { costoPorBloqueCents: number; totalCents: number; bloquesPorMezcla: number; confiable: boolean; sinPrecio: string[] };
  real: {
    costoRealPorBloqueCents: number;
    bloquesEsperados: number;
    bloquesProducidos: number;
    bloquesBuenos: number;
    rendimientoPct: number;
    desperdicioPct: number;
  };
  brechaCents: number;
  calidad: Calidad;
  perdidaRotosCents: number;
  consumo: { descripcion: string; cantidadMilli: number; unidad: string; precioUnitarioCents: number; subtotalCents: number }[];
  ensayo: {
    id: string;
    ensayadoEl: string;
    edadDias: number;
    probetas: number;
    resistenciaMpaMilli: number;
    criterio: "net" | "gross";
    fuente: string;
    origenLectura: "person" | "machine";
  } | null;
  objetivo: { mpaMilli: number; criterio: "neta" | "bruta" };
}

export interface LoteResumen {
  id: string;
  numero: number;
  producidoEl: string;
  mezclas: number;
  bloquesBuenos: number;
  bloquesRotos: number;
  costoMaterialCents: number;
  recetaNombre: string | null;
  tipoBloque: string | null;
}

export interface Material {
  id: string;
  code: string;
  name: string;
  category: string | null;
  purchaseUnit: string;
  purchasePriceCents: number;
  contentPerPurchaseMilli: number;
  bulkDensityKgM3: number | null;
  active: boolean;
  unidadDosificacion: string | null;
}

export interface Ajuste {
  key: string;
  tipo: "rango" | "numero";
  etiqueta: string;
  unidad?: string;
  ayuda: string | null;
  fabrica: unknown;
  valor: unknown;
  esDelCliente: boolean;
  norma: { min?: number; max?: number; valor?: number; fuente: string } | null;
}

export type EstadoTarea = "al dia" | "por vencer" | "vencida" | "nunca hecha";

export interface TareaMantenimiento {
  id: string;
  code: string;
  nombre: string;
  descripcion: string | null;
  esDeFabrica: boolean;
  puesto: { id: string; nombre: string } | null;
  cada: number;
  unidad: "mezclas" | "lotes";
  desde: number;
  faltan: number;
  estado: EstadoTarea;
  ultimaVez: { fecha: string; puesto: string | null; notas: string | null } | null;
}

export interface Tablero {
  contadores: { mezclas: number; lotes: number };
  tareas: TareaMantenimiento[];
  resumen: { vencidas: number; porVencer: number; total: number };
}

export interface Puesto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
}

export interface RecetaCorrible {
  id: string;
  code: string;
  name: string;
  status: string;
  expectedBlocksPerMix: number | null;
  tipoBloque: string | null;
  tipoCodigo: string | null;
}

export interface OrdenDelDia {
  /** Respaldadas por un ensayo que cumple. */
  recetas: RecetaCorrible[];
  /** Todavía sin ensayo que las respalde. Se pueden correr; no se pueden prometer. */
  enPrueba: RecetaCorrible[];
  ultimoLote: { id: string; number: number } | null;
}

export interface Unidad {
  id: string;
  name: string;
  abbreviation: string;
  kind: "mass" | "volume" | "count";
  factorMilli: number;
}

export interface TipoBloque {
  id: string;
  code: string;
  name: string;
  lengthMm: number;
  heightMm: number;
  widthMm: number;
  targetStrengthMpaMilli: number | null;
  targetStrengthBasis: "net" | "gross" | null;
}

export interface RecetaFila {
  id: string;
  code: string;
  name: string;
  status: string;
  expectedBlocksPerMix: number | null;
  blockTypeId: string;
  tipoBloque: string | null;
}

/** Lo que devuelve POST /bloques/lotes/:id/ensayos: la ficha más el aviso de edad. */
export interface FichaConAviso extends Ficha {
  avisoEdad: string | null;
}
