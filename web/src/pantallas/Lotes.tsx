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
                <th className="num">Buenos</th>
                <th className="num">Rotos</th>
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
                  <td className="num">{l.bloquesBuenos}</td>
                  <td className="num" style={{ color: l.bloquesRotos > 0 ? "var(--falla)" : undefined }}>{l.bloquesRotos}</td>
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
    </main>
  );
}
