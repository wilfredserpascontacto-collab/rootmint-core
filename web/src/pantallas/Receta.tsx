import { Link, useParams } from "react-router-dom";
import { useState } from "react";
import { api, cantidad, money, type Advertencia, type RecetaDetalle } from "../api";
import { useApi } from "../usar";
import { Banda, Cargando, Fallo, IconoAviso, IconoInfo, IconoOk } from "../comp/piezas";

export default function Receta() {
  const { id } = useParams();
  const { dato, error, cargando, recargar } = useApi<RecetaDetalle>(id ? `/bloques/recetas/${id}` : null);
  const [validando, setValidando] = useState(false);
  const [fallaValidar, setFallaValidar] = useState<string | null>(null);

  if (cargando) return <main className="lienzo"><Cargando que="la receta" /></main>;
  if (error) return <main className="lienzo"><Fallo error={error} /></main>;
  if (!dato) return null;

  const r = dato;
  const validada = r.receta.estadoEs === "validada";

  async function validar() {
    setValidando(true);
    setFallaValidar(null);
    try {
      await api.post(`/bloques/recetas/${id}/validar`);
      recargar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const det = (e as { detalle?: unknown }).detalle;
      setFallaValidar(det ? `${msg}: ${String(det)}` : msg);
    } finally {
      setValidando(false);
    }
  }

  return (
    <main className="lienzo">
      <div className="fila" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
        <div className="pila" style={{ gap: 8 }}>
          <Link to="/recetas" className="lbl" style={{ textDecoration: "none" }}>← Receta</Link>
          <div className="fila" style={{ gap: 16, flexWrap: "wrap" }}>
            <h1 className="titulo">{r.receta.name}</h1>
            <span className={`insignia ${validada ? "cumple" : "incierto"}`}>{r.receta.estadoEs}</span>
          </div>
          <span style={{ fontSize: 15, color: "var(--apagado)" }}>
            {r.tipoBloque?.name} · {r.bloquesPorMezcla} bloques por mezcla
          </span>
        </div>
        {!validada ? (
          <button className="boton hueco" onClick={validar} disabled={validando}>
            {validando ? "Validando…" : "Validar con un ensayo"}
          </button>
        ) : null}
      </div>

      {fallaValidar ? (
        <div className="aviso rojo">
          <IconoAviso color="var(--falla)" />
          <span>{fallaValidar}</span>
        </div>
      ) : null}

      <div className="rejilla dos-uno">
        <div className="tarjeta">
          <div className="fila" style={{ justifyContent: "space-between", gap: 16, padding: "16px 24px", borderBottom: "1px solid var(--linea)" }}>
            <span className="lbl">Materiales de la mezcla</span>
            <span className="mono" style={{ fontSize: 13, color: "var(--apagado)" }}>precios del catálogo, hoy</span>
          </div>
          <div className="envoltura-tabla">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Material</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Precio unit.</th>
                  <th className="num">Costo</th>
                </tr>
              </thead>
              <tbody>
                {r.renglones.map((l) => (
                  <tr key={l.id}>
                    <td>{l.nombre}</td>
                    <td className="num">{cantidad(l.cantidadMilli, l.unidad)}</td>
                    <td className="num" style={{ color: l.sinPrecio ? "var(--falla)" : "var(--apagado)" }}>
                      {l.sinPrecio ? "sin precio" : `${money(l.precioCompraCents)} / ${l.unidadCompra}`}
                    </td>
                    <td className="num">{money(l.costoCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total mezcla</td>
                  <td /><td />
                  <td className="num" style={{ fontSize: 16 }}>{money(r.totalMezclaCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="tarjeta fuerte pila">
          <div className="pila" style={{ gap: 8, padding: "26px 24px", borderBottom: "1px solid var(--linea)" }}>
            <span className="lbl">Costo teórico por bloque</span>
            <span className="cifra mono" style={{ fontSize: "clamp(46px, 6vw, 62px)" }}>
              {money(r.costoPorBloqueCents)}
            </span>
            <span className="mono" style={{ fontSize: 13, color: "var(--apagado)" }}>
              {money(r.totalMezclaCents)} ÷ {r.bloquesPorMezcla} bloques
            </span>
          </div>
          <div className="pila" style={{ gap: 8, padding: "22px 24px" }}>
            <div className="fila" style={{ gap: 8 }}>
              {r.confiable ? <IconoOk color="var(--cumple)" size={18} /> : <IconoAviso color="var(--falla)" size={18} />}
              <span className="cond" style={{ fontSize: 15, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: r.confiable ? "var(--cumple)" : "var(--falla)" }}>
                {r.confiable ? "Cifra confiable" : "Cifra no confiable"}
              </span>
            </div>
            <span style={{ fontSize: 14, lineHeight: 1.5, color: "var(--apagado)" }}>
              {r.confiable
                ? "Todos los materiales tienen precio cargado."
                : `${r.sinPrecio.length + r.faltantes.length} material(es) no aportan al total. El bloque parece más barato de lo que es.`}
            </span>
          </div>
        </div>
      </div>

      {/* --- Advertencias --- */}
      <div className="tarjeta pila" style={{ gap: 16, padding: "24px 28px 28px" }}>
        <div className="fila" style={{ justifyContent: "space-between", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
          <span className="lbl">Advertencias · la mezcla contra los rangos</span>
          <span style={{ fontSize: 13, color: "var(--tenue)" }}>
            La barra clara es su rango. La marca oscura debajo es la norma, y no se mueve.
          </span>
        </div>

        {r.advertencias.map((a, i) => (
          <div key={a.key}>
            {i > 0 ? <div style={{ height: 1, background: "var(--linea-suave)", marginBottom: 16 }} /> : null}
            <FilaAdvertencia a={a} />
          </div>
        ))}

        <div className="aviso ambar" style={{ marginTop: 4 }}>
          <IconoAviso color="var(--ambar-tinta)" />
          <span>
            Una advertencia no bloquea nada: la receta se puede correr igual. Ninguna de estas
            proporciones predice la resistencia. Lo único que decide si el bloque sirve es el ensayo.
          </span>
        </div>
      </div>
    </main>
  );
}

/** "Norma: 6 a 9" cuando es un rango; "Óptimo citado: 0.5" cuando es un solo valor. */
function textoNorma(a: Advertencia): string {
  const n = a.norma;
  if (!n) return "";
  const par = a.unidad === "1 : x" ? (v: number) => `1:${v}` : (v: number) => String(v);
  if (n.valor !== undefined && n.min === undefined && n.max === undefined) {
    return `Óptimo citado: ${par(n.valor)}`;
  }
  if (n.min !== undefined && n.max !== undefined) return `Norma: ${par(n.min)} a ${par(n.max)}`;
  if (n.max !== undefined) return `Norma: hasta ${par(n.max)}`;
  if (n.min !== undefined) return `Norma: desde ${par(n.min)}`;
  return "";
}

function FilaAdvertencia({ a }: { a: Advertencia }) {
  const fuera = a.disponible && a.estado !== "dentro";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 250px) 1fr 170px", gap: 22, alignItems: "center" }}>
      <div className="pila" style={{ gap: 2 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{a.etiqueta}</span>
        <span className="mono" style={{ fontSize: 12, color: "var(--tenue)" }}>
          {a.rango.esDelCliente ? "rango suyo" : "rango de fábrica"}{" "}
          {a.unidad === "1 : x" ? `1:${a.rango.min} a 1:${a.rango.max}` : `${a.rango.min} a ${a.rango.max}${a.unidad ? " " + a.unidad : ""}`}
        </span>
      </div>

      {a.disponible ? (
        <div className="pila" style={{ gap: 5 }}>
          <Banda a={a} />
          {a.pasaLaNorma ? (
            <span style={{ fontSize: 12.5, lineHeight: 1.35, color: "var(--apagado)" }}>
              Dentro de su rango. Pasa la norma por {a.pasaLaNorma} —{a.norma?.fuente}.
            </span>
          ) : (
            <span style={{ fontSize: 12.5, lineHeight: 1.35, color: "var(--tenue)" }}>
              {textoNorma(a)}
            </span>
          )}
        </div>
      ) : (
        <div className="fila" style={{ gap: 10 }}>
          <IconoInfo color="var(--tenue)" size={18} />
          <span style={{ fontSize: 13.5, lineHeight: 1.4, color: "var(--apagado)" }}>{a.motivo}</span>
        </div>
      )}

      <div className="pila" style={{ alignItems: "flex-end", gap: 3 }}>
        {a.disponible && a.valorMilli !== undefined ? (
          <>
            <span className="cifra mono" style={{ fontSize: 26, color: fuera ? "var(--falla)" : "var(--tinta)" }}>
              {a.unidad === "1 : x" ? `1:${(a.valorMilli / 1000).toFixed(1)}` : (a.valorMilli / 1000).toFixed(2)}
            </span>
            <span className={`insignia ${fuera ? "falla" : "cumple"}`}>{a.estado}</span>
          </>
        ) : (
          <span className="insignia incierto">sin dato</span>
        )}
      </div>
    </div>
  );
}
