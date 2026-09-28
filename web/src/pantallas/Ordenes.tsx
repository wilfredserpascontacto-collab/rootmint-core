import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, fecha, type OrdenProduccion, type RenglonOrden, type EstadoOrden } from "../api";
import { useApi } from "../usar";
import { Cargando, Campo, Fallo, IconoInfo } from "../comp/piezas";

const NOMBRE: Record<EstadoOrden, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  terminada: "Terminada",
  anulada: "Anulada",
};

/**
 * La cola de la planta.
 *
 * Lo vivo primero y lo más urgente arriba, porque esta pantalla contesta una
 * sola pregunta —«¿qué hay que fabricar?»— y cualquier otro orden la vuelve
 * un archivo.
 */
export default function Ordenes() {
  const [ver, setVer] = useState<"vivas" | "todas">("vivas");
  const { dato, error, cargando } = useApi<(OrdenProduccion & { resumen: string; pedido: number; producido: number })[]>(
    `/ordenes?estado=${ver}`,
  );

  if (cargando) return <main className="lienzo"><Cargando que="las órdenes" /></main>;
  if (error) return <main className="lienzo"><Fallo error={error} /></main>;

  const filas = dato ?? [];

  return (
    <main className="lienzo">
      <div className="fila" style={{ justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div className="pila" style={{ gap: 6 }}>
          <h1 className="titulo">ÓRDENES DE PRODUCCIÓN</h1>
          <span style={{ fontSize: 16, color: "var(--apagado)" }}>
            Lo que el área comercial le mandó a fabricar a la planta.
          </span>
        </div>
        <div className="fila" style={{ gap: 10 }}>
          <button className={ver === "vivas" ? "boton" : "boton hueco"} onClick={() => setVer("vivas")}>
            Abiertas
          </button>
          <button className={ver === "todas" ? "boton" : "boton hueco"} onClick={() => setVer("todas")}>
            Todas
          </button>
        </div>
      </div>

      {filas.length === 0 ? (
        <div className="aviso" style={{ marginTop: 20 }}>
          <IconoInfo />
          <span>
            {ver === "vivas"
              ? "No hay ninguna orden abierta. Una orden nace desde una cotización, en el área comercial: el botón «Pasar a producción»."
              : "Todavía no se ha creado ninguna orden."}
          </span>
        </div>
      ) : (
        <div className="pila" style={{ gap: 12, marginTop: 20 }}>
          {filas.map((o) => (
            <Link key={o.id} to={`/ordenes/${o.id}`} className="tarjeta" style={{ padding: 18, textDecoration: "none" }}>
              <div className="fila" style={{ justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "baseline" }}>
                <div className="pila" style={{ gap: 4 }}>
                  <span style={{ fontSize: 20, fontWeight: 700 }}>
                    Orden N° {o.number}
                    {o.customerName ? <span style={{ fontWeight: 400 }}> · {o.customerName}</span> : null}
                  </span>
                  <span style={{ fontSize: 15, color: "var(--apagado)" }}>{o.resumen}</span>
                </div>
                <div className="pila mono" style={{ alignItems: "flex-end", gap: 4 }}>
                  <span style={{ fontSize: 22 }}>
                    {o.producido} / {o.pedido}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--apagado)" }}>
                    {NOMBRE[o.status]}
                    {o.neededBy ? ` · para el ${fecha(o.neededBy)}` : ""}
                  </span>
                </div>
              </div>
              <div className="progreso" style={{ marginTop: 12 }}>
                <span style={{ width: `${o.pedido ? Math.min(100, (o.producido / o.pedido) * 100) : 0}%` }} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

type Detalle = Omit<OrdenProduccion, "lines"> & {
  pedido: number;
  producido: number;
  completa: boolean;
  lines: (RenglonOrden & {
    id: string;
    code: string | null;
    recetas: { id: string; name: string; status: string }[];
  })[];
  lotes: { id: string; number: number; producedAt: string; blocksGood: number; blocksBroken: number }[];
};

/** La orden entera: qué pidió, qué se corrió contra ella, y cómo cerrarla. */
export function FichaOrden() {
  const { id } = useParams();
  const { dato, error, cargando, recargar } = useApi<Detalle>(id ? `/ordenes/${id}` : null);
  const [motivo, setMotivo] = useState("");
  const [accion, setAccion] = useState<"" | "cerrar" | "anular">("");
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);

  if (cargando) return <main className="lienzo"><Cargando que="la orden" /></main>;
  if (error) return <main className="lienzo"><Fallo error={error} /></main>;
  if (!dato) return null;

  const o = dato;
  const viva = o.status === "pendiente" || o.status === "en_proceso";

  async function confirmar() {
    if (!accion || ocupado) return;
    setOcupado(true);
    setFalla(null);
    try {
      const r = await api.post<Detalle & { avisos?: string[] }>(`/ordenes/${id}/${accion}`, {
        reason: motivo,
      });
      setAvisos(r.avisos ?? []);
      setAccion("");
      setMotivo("");
      recargar();
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <main className="lienzo">
      <div className="pila" style={{ gap: 6 }}>
        <Link to="/ordenes" className="lbl" style={{ textDecoration: "none" }}>← Órdenes</Link>
        <div className="fila" style={{ gap: 18, alignItems: "baseline", flexWrap: "wrap" }}>
          <h1 className="titulo">ORDEN N° {o.number}</h1>
          <span style={{ fontSize: 17, color: "var(--apagado)" }}>
            {NOMBRE[o.status]}
            {o.customerName ? ` · ${o.customerName}` : ""}
            {o.neededBy ? ` · para el ${fecha(o.neededBy)}` : ""}
          </span>
        </div>
      </div>

      {avisos.map((a, i) => (
        <div className="aviso" key={i} style={{ marginTop: 14 }}>
          <IconoInfo />
          <span>{a}</span>
        </div>
      ))}

      {o.closeReason ? (
        <div className="aviso" style={{ marginTop: 14 }}>
          <IconoInfo />
          <span>{o.closeReason}</span>
        </div>
      ) : null}

      <section className="tarjeta pila" style={{ gap: 14, padding: 20, marginTop: 18 }}>
        <span className="lbl">Qué hay que fabricar</span>
        {o.lines.map((l) => (
          <div key={l.id} className="pila" style={{ gap: 6 }}>
            <div className="fila" style={{ justifyContent: "space-between", gap: 16, alignItems: "baseline" }}>
              <span style={{ fontSize: 18 }}>{l.description}</span>
              <span className="mono" style={{ fontSize: 18 }}>
                {l.producido} / {l.quantity}
                {l.falta > 0 ? <span style={{ color: "var(--apagado)" }}> · faltan {l.falta}</span> : null}
              </span>
            </div>
            <div className="progreso">
              <span style={{ width: `${l.quantity ? Math.min(100, (l.producido / l.quantity) * 100) : 0}%` }} />
            </div>
            {l.recetas.length === 0 ? (
              <span style={{ fontSize: 14, color: "var(--falla)" }}>
                No hay ninguna receta cargada que dé este bloque. Sin receta no se puede correr.
              </span>
            ) : (
              <span style={{ fontSize: 14, color: "var(--apagado)" }}>
                Se corre con: {l.recetas.map((r) => r.name).join(", ")}
              </span>
            )}
          </div>
        ))}
        {o.notes ? <p style={{ margin: 0, fontSize: 15 }}>{o.notes}</p> : null}
        {o.quoteId ? (
          <Link to={`/comercial/cotizaciones/${o.quoteId}`} style={{ fontSize: 15 }}>
            Ver la cotización que la pidió →
          </Link>
        ) : (
          <span style={{ fontSize: 15, color: "var(--apagado)" }}>
            Orden suelta: no salió de ninguna cotización. Se produce para tener existencia.
          </span>
        )}
      </section>

      <section className="tarjeta pila" style={{ gap: 12, padding: 20, marginTop: 18 }}>
        <span className="lbl">Lotes corridos contra esta orden</span>
        {o.lotes.length === 0 ? (
          <span style={{ fontSize: 16, color: "var(--apagado)" }}>
            Todavía no se ha corrido ninguno. Desde <Link to="/planta">Planta</Link> se elige esta orden
            antes de cerrar el lote.
          </span>
        ) : (
          o.lotes.map((l) => (
            <Link key={l.id} to={`/lotes/${l.id}`} className="fila" style={{ justifyContent: "space-between", gap: 16, textDecoration: "none" }}>
              <span>Lote {String(l.number).padStart(3, "0")} · {fecha(l.producedAt)}</span>
              <span className="mono">
                {l.blocksGood} buenos
                {l.blocksBroken > 0 ? <span style={{ color: "var(--falla)" }}> · {l.blocksBroken} rotos</span> : null}
              </span>
            </Link>
          ))
        )}
      </section>

      {viva ? (
        <section className="tarjeta pila" style={{ gap: 14, padding: 20, marginTop: 18 }}>
          <span className="lbl">Cerrar esta orden</span>
          <p style={{ margin: 0, fontSize: 15, color: "var(--apagado)", lineHeight: 1.5 }}>
            Si se completa, se cierra sola. Estos dos botones son para los otros dos casos:{" "}
            <strong>cerrarla</strong> cuando se decide no fabricar el resto, y <strong>anularla</strong>{" "}
            cuando no debió existir. Lo que ya se produjo queda en el patio en los dos casos.
          </p>
          {accion === "" ? (
            <div className="fila" style={{ gap: 10, flexWrap: "wrap" }}>
              <button className="boton hueco" onClick={() => setAccion("cerrar")}>
                Cerrar con lo que hay
              </button>
              <button className="boton hueco" onClick={() => setAccion("anular")}>
                Anular
              </button>
            </div>
          ) : (
            <div className="pila" style={{ gap: 12 }}>
              <Campo etiqueta={accion === "cerrar" ? "Por qué se cierra" : "Por qué se anula"}>
                <input
                  className="entrada"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  aria-label={accion === "cerrar" ? "Por qué se cierra" : "Por qué se anula"}
                  placeholder={accion === "cerrar" ? "El cliente se conformó con lo entregado" : "Se duplicó por error"}
                />
              </Campo>
              <div className="fila" style={{ gap: 10 }}>
                <button className="boton" onClick={confirmar} disabled={ocupado || motivo.trim().length < 3}>
                  {ocupado ? "Guardando…" : accion === "cerrar" ? "Sí, cerrar" : "Sí, anular"}
                </button>
                <button className="boton hueco" onClick={() => { setAccion(""); setMotivo(""); }}>
                  No
                </button>
              </div>
            </div>
          )}
          {falla ? <div className="error">{falla}</div> : null}
        </section>
      ) : null}
    </main>
  );
}
