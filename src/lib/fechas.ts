/**
 * Dias de calendario, escritos AAAA-MM-DD.
 *
 * Todo lo que tiene que ver con garantias y plazos es aritmetica de DIAS, no
 * de instantes: «hasta el 15 de marzo» no tiene hora, y mezclar zonas
 * horarias hace que un plazo termine un dia antes o despues sin que nadie lo
 * note. Aqui no hay `new Date()` sobre texto local: se trabaja con partes
 * enteras y con UTC, que no tiene horario de verano.
 */

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

export function esDia(s: string): boolean {
  const m = DIA.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.toISOString().slice(0, 10) === s;
}

function partes(s: string): [number, number, number] {
  const m = DIA.exec(s);
  if (!m) throw new Error(`«${s}» no es un día AAAA-MM-DD`);
  return [+m[1]!, +m[2]!, +m[3]!];
}

function aTexto(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const MS_DIA = 86_400_000;

/** El dia de hoy en El Salvador (UTC-6, sin horario de verano). */
export function hoyEnElSalvador(ahora: number = Date.now()): string {
  return aTexto(ahora - 6 * 3_600_000);
}

export function sumarDias(dia: string, n: number): string {
  const [y, m, d] = partes(dia);
  return aTexto(Date.UTC(y, m - 1, d) + n * MS_DIA);
}

/** Cuantos dias hay de `a` a `b` (negativo si `b` es anterior). */
export function diasEntre(a: string, b: string): number {
  const [ya, ma, da] = partes(a);
  const [yb, mb, db] = partes(b);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / MS_DIA);
}

function diasDelMes(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // m es 1..12
}

/**
 * El mismo dia, N meses despues.
 *
 * Si ese dia no existe en el mes de llegada se usa el ultimo del mes: 6 meses
 * despues del 31 de agosto es el 28 de febrero, no el 3 de marzo. Es lo que
 * entiende cualquiera por «seis meses de garantia» y evita que un plazo se
 * corra de mes sin que nadie lo vea.
 */
export function sumarMeses(dia: string, n: number): string {
  const [y, m, d] = partes(dia);
  const idx = y * 12 + (m - 1) + n;
  const ty = Math.floor(idx / 12);
  const tm = (idx % 12) + 1;
  const td = Math.min(d, diasDelMes(ty, tm));
  return `${String(ty).padStart(4, "0")}-${String(tm).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
}

/** Primer y ultimo dia del mes de `dia`. */
export function limitesDelMes(dia: string): { desde: string; hasta: string } {
  const [y, m] = partes(dia);
  const mm = String(m).padStart(2, "0");
  return { desde: `${y}-${mm}-01`, hasta: `${y}-${mm}-${String(diasDelMes(y, m)).padStart(2, "0")}` };
}
