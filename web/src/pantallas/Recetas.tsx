import { Link } from "react-router-dom";
import { useApi } from "../usar";
import { Cargando, Fallo } from "../comp/piezas";

interface Fila {
  id: string; code: string; name: string; status: string;
  expectedBlocksPerMix: number | null; tipoBloque: string | null;
}

export default function Recetas() {
  const { dato, error, cargando } = useApi<Fila[]>("/bloques/recetas");

  if (cargando) return <main className="lienzo"><Cargando que="las recetas" /></main>;
  if (error) return <main className="lienzo"><Fallo error={error} /></main>;

  const es = (s: string) => (s === "validated" ? "validada" : s === "retired" ? "retirada" : "borrador");

  return (
    <main className="lienzo">
      <h1 className="titulo">Recetas</h1>
      <div className="tarjeta envoltura-tabla">
        <table className="tabla">
          <thead>
            <tr>
              <th>Receta</th><th>Bloque</th>
              <th className="num">Bloques por mezcla</th><th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {(dato ?? []).map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/recetas/${r.id}`} style={{ fontWeight: 600, textDecoration: "none", color: "var(--tinta)" }}>
                    {r.name}
                  </Link>
                  <span className="mono" style={{ marginLeft: 10, fontSize: 12, color: "var(--tenue)" }}>{r.code}</span>
                </td>
                <td>{r.tipoBloque ?? "—"}</td>
                <td className="num">{r.expectedBlocksPerMix ?? "—"}</td>
                <td><span className={`insignia ${r.status === "validated" ? "cumple" : "incierto"}`}>{es(r.status)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--apagado)", maxWidth: "68ch" }}>
        Una receta solo se vuelve <strong>validada</strong> cuando un lote suyo pasa el ensayo de
        resistencia. No se valida por decreto: eso convertiría el estado en decoración.
      </p>
    </main>
  );
}
