/** Piezas compartidas: iconos dibujados, estados de carga y la banda de rango. */

import type { ReactNode } from "react";
import type { Advertencia, Calidad } from "../api";

export function IconoAviso({ color = "currentColor", size = 20 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4" /><path d="M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}

export function IconoInfo({ color = "currentColor", size = 20 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
    </svg>
  );
}

export function IconoOk({ color = "currentColor", size = 20 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function Cargando({ que }: { que: string }) {
  return <div className="cargando">Cargando {que}…</div>;
}

export function Fallo({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="error">
      <strong>No se pudo cargar.</strong> {msg}
    </div>
  );
}

/** Clase de insignia según el veredicto de calidad. Gris para lo que no se sabe. */
export function claseCalidad(c: Calidad): string {
  if (c.estado === "cumple") return "cumple";
  if (c.estado === "no cumple") return "falla";
  if (c.estado === "no comparable") return "aviso";
  return "incierto";
}

/**
 * La banda: el rango del cliente en claro, la norma dibujada detrás en oscuro,
 * y la marca del valor. Cuando el cliente ensancha su rango, la norma no se
 * mueve — apartarse de ella tiene que verse.
 */
export function Banda({ a }: { a: Advertencia }) {
  if (!a.disponible || a.valorMilli === undefined) return null;

  const valor = a.valorMilli / 1000;
  const n: NonNullable<Advertencia["norma"]> | { min?: number; max?: number; valor?: number } = a.norma ?? {};
  const nMin = n.min ?? n.valor ?? a.rango.min;
  const nMax = n.max ?? n.valor ?? a.rango.max;

  // El eje abarca rango, norma y valor, con holgura para que la marca no
  // quede pegada al borde cuando el valor se sale de todo.
  const lo = Math.min(a.rango.min, nMin, valor);
  const hi = Math.max(a.rango.max, nMax, valor);
  const holgura = (hi - lo) * 0.15 || 1;
  const desde = lo - holgura;
  const hasta = hi + holgura;
  const pct = (v: number) => ((v - desde) / (hasta - desde)) * 100;

  const fueraDelRango = a.estado !== "dentro";
  const color = fueraDelRango ? "var(--falla)" : "var(--tinta)";

  return (
    <div className="pila" style={{ gap: 5 }}>
      <div className="banda">
        <div className="rango" style={{ left: `${pct(a.rango.min)}%`, width: `${pct(a.rango.max) - pct(a.rango.min)}%` }} />
        <div className="marca" style={{ left: `${pct(valor)}%`, background: color }} />
      </div>
      <div className="norma-linea">
        <span style={{ left: `${pct(nMin)}%`, width: `${Math.max(1, pct(nMax) - pct(nMin))}%` }} />
      </div>
    </div>
  );
}

export function Campo({ etiqueta, children, ayuda }: { etiqueta: string; children: ReactNode; ayuda?: string }) {
  return (
    <div className="pila" style={{ gap: 6 }}>
      <span className="lbl">{etiqueta}</span>
      {children}
      {ayuda ? <span style={{ fontSize: 13, color: "var(--tenue)", lineHeight: 1.4 }}>{ayuda}</span> : null}
    </div>
  );
}
