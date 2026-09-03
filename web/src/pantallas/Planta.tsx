import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Ficha, type OrdenDelDia } from "../api";
import { useApi } from "../usar";
import { Cargando, Fallo } from "../comp/piezas";

/**
 * La pantalla de planta.
 *
 * Se usa de pie, con las manos sucias y con sol. Por eso: pocos campos,
 * botones de 72 px, cifras enormes, y nada de cronómetros ni animaciones.
 *
 * En la fase 1 el software es la ORDEN DE TRABAJO: primero dice qué correr y
 * cuánto se espera, y solo después registra lo que salió. Un sistema que solo
 * captura le pide al operario que ya sepa qué hacer.
 */
export default function Planta() {
  const navegar = useNavigate();
  const { dato: orden, error, cargando } = useApi<OrdenDelDia>("/bloques/orden-del-dia");

  const [recetaId, setRecetaId] = useState<string>("");
  const [mezclas, setMezclas] = useState(1);
  const [buenos, setBuenos] = useState(0);
  const [rotos, setRotos] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);

  useEffect(() => {
    if (!recetaId && orden?.recetas[0]) setRecetaId(orden.recetas[0].id);
  }, [orden, recetaId]);

  if (cargando) return <main className="lienzo"><Cargando que="la orden del día" /></main>;
  if (error) return <main className="lienzo"><Fallo error={error} /></main>;

  const receta = orden?.recetas.find((r) => r.id === recetaId) ?? null;
  const porMezcla = receta?.expectedBlocksPerMix ?? 0;
  const esperados = porMezcla * mezclas;
  const contados = buenos + rotos;

  async function cerrar() {
    if (!receta) return;
    setGuardando(true);
    setFalla(null);
    try {
      const ficha = await api.post<Ficha>("/bloques/lotes", {
        recipeId: receta.id,
        mixes: mezclas,
        blocksGood: buenos,
        blocksBroken: rotos,
      });
      navegar(`/lotes/${ficha.lote.id}`);
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
      setGuardando(false);
    }
  }

  if (!orden || orden.recetas.length === 0) {
    return (
      <main className="lienzo planta">
        <div className="aviso ambar">
          <span>
            No hay ninguna receta validada todavía. Una receta se valida cuando un lote suyo pasa
            el ensayo de resistencia: hasta entonces no se puede mandar a producir con ella.
          </span>
        </div>
      </main>
    );
  }

  return (
    <main className="lienzo planta">
      {/* --- La orden: qué correr --- */}
      <div className="tarjeta pila" style={{ gap: 14, padding: 20 }}>
        <span className="lbl">Qué se corre hoy</span>
        <select
          className="entrada"
          value={recetaId}
          onChange={(e) => setRecetaId(e.target.value)}
          style={{ fontFamily: "var(--texto)", fontSize: 18 }}
        >
          {orden.recetas.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} — {r.tipoBloque ?? r.tipoCodigo}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 15, color: "var(--apagado)" }}>
          {porMezcla} bloques por mezcla · se esperan <strong>{esperados}</strong> con {mezclas}{" "}
          {mezclas === 1 ? "mezcla" : "mezclas"}
        </span>
      </div>

      <Contador etiqueta="Mezclas corridas" valor={mezclas} min={1} set={setMezclas} />

      <div className="tarjeta pila" style={{ gap: 14, padding: 20 }}>
        <div className="fila" style={{ justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <span className="lbl">Bloques buenos</span>
          <span className="mono" style={{ fontSize: 14, color: "var(--apagado)" }}>de {esperados} esperados</span>
        </div>
        <Pasos valor={buenos} set={setBuenos} paso={10} />
        <div className="progreso">
          <span style={{ width: `${esperados ? Math.min(100, (buenos / esperados) * 100) : 0}%` }} />
        </div>
      </div>

      <Contador etiqueta="Bloques rotos" valor={rotos} set={setRotos} paso={5} color="var(--falla)" />

      {contados > esperados ? (
        <div className="aviso ambar">
          <span>
            Van {contados} bloques contados y la receta esperaba {esperados}. No es un error —puede
            haber salido más—, pero conviene revisarlo antes de cerrar.
          </span>
        </div>
      ) : null}

      {falla ? <div className="error">{falla}</div> : null}

      <button
        className="boton"
        onClick={cerrar}
        disabled={guardando || !receta || contados === 0}
        style={{ background: "var(--ambar)", color: "var(--tinta)", fontSize: 26, padding: 22, minHeight: 72 }}
      >
        {guardando ? "Cerrando…" : "Cerrar lote"}
      </button>

      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: "var(--apagado)", textAlign: "center" }}>
        Al cerrar se congela el costo con los precios de hoy y el lote queda esperando el ensayo.
      </p>
    </main>
  );
}

function Contador({
  etiqueta, valor, set, min = 0, paso = 1, color,
}: { etiqueta: string; valor: number; set: (n: number) => void; min?: number; paso?: number; color?: string }) {
  return (
    <div className="tarjeta pila" style={{ gap: 14, padding: 20 }}>
      <span className="lbl">{etiqueta}</span>
      <Pasos valor={valor} set={set} min={min} paso={paso} color={color} />
    </div>
  );
}

/** Botones de 72 px y toques de a diez: contar de uno en uno 470 veces no es una interfaz. */
function Pasos({
  valor, set, min = 0, paso = 1, color,
}: { valor: number; set: (n: number) => void; min?: number; paso?: number; color?: string }) {
  return (
    <div className="pila" style={{ gap: 10 }}>
      <div className="contador">
        <button className="paso" onClick={() => set(Math.max(min, valor - paso))} aria-label={`Restar ${paso}`}>
          −{paso > 1 ? paso : ""}
        </button>
        <span className="valor" style={color ? { color } : undefined}>{valor}</span>
        <button className="paso mas" onClick={() => set(valor + paso)} aria-label={`Sumar ${paso}`}>
          +{paso > 1 ? paso : ""}
        </button>
      </div>
      {paso > 1 ? (
        <div className="fila" style={{ gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button className="boton hueco" style={{ minWidth: 76 }} onClick={() => set(Math.max(min, valor - 1))}>−1</button>
          <button className="boton hueco" style={{ minWidth: 76 }} onClick={() => set(valor + 1)}>+1</button>
          <button className="boton hueco" style={{ minWidth: 76 }} onClick={() => set(min)}>Cero</button>
        </div>
      ) : null}
    </div>
  );
}
