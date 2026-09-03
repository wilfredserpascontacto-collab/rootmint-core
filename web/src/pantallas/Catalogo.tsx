import { useState } from "react";
import { api, cantidad, money, type Material } from "../api";
import { useApi } from "../usar";
import { Cargando, Fallo, IconoAviso, IconoInfo } from "../comp/piezas";

/**
 * El catálogo de materiales.
 *
 * Cambiar un precio acá NO recalcula ningún lote ya cerrado: cada lote guardó
 * el precio del día en que se corrió. Lo que sí se mueve es el costo teórico
 * de las recetas, que es de hoy.
 */
export default function Catalogo() {
  const { dato, error, cargando, recargar } = useApi<Material[]>("/bloques/materiales");

  if (cargando) return <main className="lienzo"><Cargando que="el catálogo" /></main>;
  if (error) return <main className="lienzo"><Fallo error={error} /></main>;

  const materiales = dato ?? [];
  const sinPrecio = materiales.filter((m) => m.purchasePriceCents === 0);

  return (
    <main className="lienzo">
      <h1 className="titulo">Catálogo de materiales</h1>

      <div className="tarjeta envoltura-tabla">
        <table className="tabla">
          <thead>
            <tr>
              <th>Material</th>
              <th>Se compra por</th>
              <th className="num">Equivale a</th>
              <th className="num">Precio</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {materiales.map((m) => (
              <FilaMaterial key={m.id} m={m} alGuardar={recargar} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="rejilla uno-uno">
        {sinPrecio.length > 0 ? (
          <div className="aviso rojo">
            <IconoAviso color="var(--falla)" />
            <span>
              {sinPrecio.length === 1 ? "Un material no tiene precio" : `${sinPrecio.length} materiales no tienen precio`}
              {" "}({sinPrecio.map((m) => m.name).join(", ")}). Un material sin precio no cuesta cero:
              cualquier receta que lo use sale más barata de lo que es. El sistema le pone «no
              confiable» al costo hasta que le ponga precio.
            </span>
          </div>
        ) : (
          <div className="aviso neutro">
            <IconoInfo color="var(--apagado)" />
            <span>Todos los materiales tienen precio cargado. Los costos teóricos son confiables.</span>
          </div>
        )}

        <div className="aviso neutro">
          <IconoInfo color="var(--apagado)" />
          <span>
            Cambiar un precio hoy no toca los lotes ya cerrados: cada lote guarda el precio del día
            en que se corrió. Lo que sí se mueve es el costo teórico de las recetas.
          </span>
        </div>
      </div>
    </main>
  );
}

function FilaMaterial({ m, alGuardar }: { m: Material; alGuardar: () => void }) {
  const [texto, setTexto] = useState((m.purchasePriceCents / 100).toFixed(2));
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);

  const cents = Math.round(Number(texto.replace(",", ".")) * 100);
  const valido = Number.isFinite(cents) && cents >= 0;
  const sucio = valido && cents !== m.purchasePriceCents;

  async function guardar() {
    if (!valido) return;
    setOcupado(true); setFalla(null);
    try {
      await api.patch(`/bloques/materiales/${m.id}`, { purchasePriceCents: cents });
      alGuardar();
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally { setOcupado(false); }
  }

  return (
    <tr style={m.purchasePriceCents === 0 ? { background: "var(--falla-fondo)" } : undefined}>
      <td>
        <div className="pila" style={{ gap: 2 }}>
          <span style={{ fontWeight: 500 }}>{m.name}</span>
          <span className="mono" style={{ fontSize: 12, color: "var(--tenue)" }}>{m.category ?? ""}</span>
        </div>
      </td>
      <td className="mono" style={{ fontSize: 14 }}>{m.purchaseUnit}</td>
      <td className="num" style={{ color: "var(--apagado)" }}>
        {cantidad(m.contentPerPurchaseMilli, m.unidadDosificacion ?? "")}
      </td>
      <td className="num">
        <div className="fila" style={{ gap: 8, justifyContent: "flex-end" }}>
          <span style={{ color: "var(--apagado)" }}>$</span>
          <input
            className="entrada"
            style={{ width: 104, textAlign: "right", padding: "7px 10px", minHeight: 40 }}
            value={texto}
            inputMode="decimal"
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") guardar(); }}
            aria-label={`Precio de ${m.name}`}
          />
        </div>
        {m.purchasePriceCents === 0 ? (
          <span className="cond" style={{ display: "block", marginTop: 4, fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--falla)" }}>
            Sin precio
          </span>
        ) : null}
        {falla ? <span style={{ display: "block", marginTop: 4, fontSize: 12, color: "var(--falla)" }}>{falla}</span> : null}
      </td>
      <td>
        {sucio ? (
          <button className="boton" style={{ padding: "8px 14px", minHeight: 40 }} onClick={guardar} disabled={ocupado}>
            {ocupado ? "…" : "Guardar"}
          </button>
        ) : (
          <span className="mono" style={{ fontSize: 13, color: "var(--tenue)" }}>
            {money(m.purchasePriceCents)}
          </span>
        )}
      </td>
    </tr>
  );
}
