import { Link } from "react-router-dom";
import { fecha, money, type LoteResumen } from "../api";
import { useApi } from "../usar";
import { Cargando, Fallo } from "../comp/piezas";

export default function Lotes() {
  const { dato, error, cargando } = useApi<LoteResumen[]>("/bloques/lotes");

  if (cargando) return <main className="lienzo"><Cargando que="los lotes" /></main>;
  if (error) return <main className="lienzo"><Fallo error={error} /></main>;

  const lotes = dato ?? [];

  return (
    <main className="lienzo">
      <div className="fila" style={{ justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
        <h1 className="titulo">Lotes</h1>
        <Link to="/planta" className="boton">Abrir un lote</Link>
      </div>

      {lotes.length === 0 ? (
        <div className="vacio">
          Todavía no hay lotes. El primero se abre desde la pantalla de planta.
        </div>
      ) : (
        <div className="tarjeta envoltura-tabla">
          <table className="tabla">
            <thead>
              <tr>
                <th>Lote</th>
                <th>Receta</th>
                <th>Producido</th>
                <th className="num">Mezclas</th>
                <th className="num">Salieron</th>
                <th className="num">Buenos</th>
                <th className="num">Rotos</th>
                <th className="num">Rendimiento</th>
                <th className="num">Costo material</th>
                <th className="num">Real / bloque</th>
              </tr>
            </thead>
            <tbody>
              {lotes.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Link to={`/lotes/${l.id}`} style={{ fontFamily: "var(--cond)", fontSize: 18, fontWeight: 700, textDecoration: "none", color: "var(--tinta)" }}>
                      {String(l.numero).padStart(3, "0")}
                    </Link>
                  </td>
                  <td>{l.recetaNombre ?? "—"} <span style={{ color: "var(--tenue)" }}>· {l.tipoBloque ?? ""}</span></td>
                  <td className="mono" style={{ fontSize: 14 }}>{fecha(l.producidoEl)}</td>
                  <td className="num">{l.mezclas}</td>
                  {/* Salieron de los que se esperaban: sin el denominador,
                      "470 buenos" no dice si el lote salió bien o mal. */}
                  <td className="num" style={{ color: "var(--apagado)", whiteSpace: "nowrap" }}>
                    {l.bloquesEsperados !== null
                      ? `${l.bloquesBuenos + l.bloquesRotos} de ${l.bloquesEsperados}`
                      : l.bloquesBuenos + l.bloquesRotos}
                  </td>
                  <td className="num">{l.bloquesBuenos}</td>
                  <td className="num" style={{ color: l.bloquesRotos > 0 ? "var(--falla)" : undefined }}>{l.bloquesRotos}</td>
                  <td className="num"><Rendimiento pct={l.rendimientoPct} /></td>
                  <td className="num">{money(l.costoMaterialCents)}</td>
                  <td className="num" style={{ fontWeight: 500 }}>
                    {money(Math.round(l.costoMaterialCents / Math.max(1, l.bloquesBuenos)))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--apagado)", maxWidth: "70ch" }}>
        El rendimiento es lo que compara un lote con otro: son los bloques buenos contra los que la
        receta esperaba. Un lote grande que rindió mal produjo más bloques y menos negocio que uno
        chico que rindió bien.
      </p>
    </main>
  );
}

/**
 * El rendimiento con su color.
 *
 * El umbral no es un capricho: por debajo de 90% la ficha del lote ya lo
 * marca en rojo, así que la lista usa el mismo corte. Que dos pantallas
 * llamen "malo" a cosas distintas es peor que no colorear nada.
 *
 * Sin receta que diga cuántos bloques se esperaban no hay contra qué
 * comparar, y entonces se dice que no se sabe en vez de inventar un cero.
 */
function Rendimiento({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span style={{ color: "var(--incierto)" }}>—</span>;
  }
  const color = pct < 90 ? "var(--falla)" : pct >= 100 ? "var(--cumple)" : "var(--tinta)";
  return <span style={{ color, fontWeight: 500 }}>{pct}%</span>;
}
