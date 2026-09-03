import { useState } from "react";
import { api, fecha, type EstadoTarea, type Puesto, type Tablero, type TareaMantenimiento } from "../api";
import { useApi } from "../usar";
import { Cargando, Fallo, IconoAviso, IconoInfo, IconoOk } from "../comp/piezas";

/**
 * Mantenimiento y limpieza, medidos por uso.
 *
 * En una bloquera esto no es aseo: el molde sucio saca bloques deformes y el
 * vibrador desajustado baja la resistencia. Por eso las tareas se disparan por
 * cuánto trabajó la máquina, no por el día de la semana.
 *
 * Y por eso nada de esto bloquea la producción: avisa y deja constancia, igual
 * que una advertencia de mezcla. Quien decide es la planta.
 */
export default function Mantenimiento() {
  const { dato, error, cargando, recargar } = useApi<Tablero>("/bloques/mantenimiento");
  const { dato: puestos } = useApi<Puesto[]>("/bloques/puestos");

  if (cargando) return <main className="lienzo"><Cargando que="el mantenimiento" /></main>;
  if (error) return <main className="lienzo"><Fallo error={error} /></main>;
  if (!dato) return null;

  const { contadores, tareas, resumen } = dato;
  const vencidas = tareas.filter((t) => t.estado === "vencida");
  const resto = tareas.filter((t) => t.estado !== "vencida");

  return (
    <main className="lienzo">
      <div className="fila" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
        <div className="pila" style={{ gap: 6 }}>
          <h1 className="titulo">Mantenimiento</h1>
          <span style={{ fontSize: 15, color: "var(--apagado)" }}>
            Las tareas se miden por uso de la máquina, no por calendario.
          </span>
        </div>
        <div className="fila mono" style={{ gap: 24, fontSize: 14, color: "var(--apagado)" }}>
          <span>La planta lleva <strong style={{ color: "var(--tinta)" }}>{contadores.mezclas}</strong> mezclas</span>
          <span>en <strong style={{ color: "var(--tinta)" }}>{contadores.lotes}</strong> lotes</span>
        </div>
      </div>

      {resumen.vencidas > 0 ? (
        <div className="aviso rojo">
          <IconoAviso color="var(--falla)" />
          <span>
            {resumen.vencidas === 1 ? "Hay una tarea vencida" : `Hay ${resumen.vencidas} tareas vencidas`}.
            No bloquean la producción: se puede correr igual. Pero cada lote que se corra así queda
            marcado, y esa marca es lo que después explica un lote que salió mal.
          </span>
        </div>
      ) : (
        <div className="aviso neutro">
          <IconoOk color="var(--cumple)" />
          <span>Nada vencido. Todo el mantenimiento está al día para el uso que lleva la planta.</span>
        </div>
      )}

      {vencidas.length > 0 ? (
        <div className="pila" style={{ gap: 12 }}>
          <span className="lbl">Vencidas</span>
          {vencidas.map((t) => (
            <Tarjeta key={t.id} t={t} puestos={puestos ?? []} alCambiar={recargar} />
          ))}
        </div>
      ) : null}

      <div className="pila" style={{ gap: 12 }}>
        <span className="lbl">{vencidas.length > 0 ? "Lo demás" : "Todas las tareas"}</span>
        {resto.map((t) => (
          <Tarjeta key={t.id} t={t} puestos={puestos ?? []} alCambiar={recargar} />
        ))}
      </div>

      <div className="aviso ambar">
        <IconoAviso color="var(--ambar-tinta)" />
        <span>
          Los intervalos que trae el sistema son un punto de partida, no una verdad. Cada prensa trae
          su manual y ese manual manda: si el fabricante de su máquina dice otra cosa, cámbielo acá.
        </span>
      </div>

      <Puestos puestos={puestos ?? []} />
    </main>
  );
}

const CLASE: Record<EstadoTarea, string> = {
  vencida: "falla",
  "por vencer": "aviso",
  "al dia": "cumple",
  "nunca hecha": "incierto",
};

function Tarjeta({
  t, puestos, alCambiar,
}: { t: TareaMantenimiento; puestos: Puesto[]; alCambiar: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [editando, setEditando] = useState(false);
  const [cada, setCada] = useState(String(t.cada));
  const [puestoId, setPuestoId] = useState(t.puesto?.id ?? "");
  const [falla, setFalla] = useState<string | null>(null);

  const pct = Math.min(100, Math.round((t.desde / Math.max(1, t.cada)) * 100));
  const color = t.estado === "vencida" ? "var(--falla)" : t.estado === "por vencer" ? "var(--ambar)" : "var(--tinta)";

  async function marcar() {
    setOcupado(true); setFalla(null);
    try {
      await api.post(`/bloques/mantenimiento/tareas/${t.id}/hecha`, {});
      alCambiar();
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally { setOcupado(false); }
  }

  async function guardar() {
    setOcupado(true); setFalla(null);
    try {
      const n = Number(cada);
      await api.patch(`/bloques/mantenimiento/tareas/${t.id}`, {
        ...(t.unidad === "mezclas" ? { everyMixes: n } : { everyBatches: n }),
        roleId: puestoId || null,
      });
      setEditando(false);
      alCambiar();
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally { setOcupado(false); }
  }

  return (
    <div className="tarjeta" style={{ padding: "18px 22px", borderLeft: `3px solid ${color}` }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 2fr) minmax(200px, 1.4fr) auto", gap: 20, alignItems: "center" }}>
        <div className="pila" style={{ gap: 5 }}>
          <div className="fila" style={{ gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>{t.nombre}</span>
            <span className={`insignia ${CLASE[t.estado]}`}>{t.estado}</span>
          </div>
          {t.descripcion ? (
            <span style={{ fontSize: 13.5, lineHeight: 1.45, color: "var(--apagado)" }}>{t.descripcion}</span>
          ) : null}
          <span className="mono" style={{ fontSize: 12.5, color: "var(--tenue)" }}>
            {t.puesto?.nombre ?? "sin puesto asignado"}
            {t.ultimaVez ? ` · última vez ${fecha(t.ultimaVez.fecha)}` : " · nunca registrada"}
          </span>
        </div>

        <div className="pila" style={{ gap: 6 }}>
          {editando ? (
            <div className="fila" style={{ gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, color: "var(--apagado)" }}>cada</span>
              <input className="entrada" style={{ width: 78, minHeight: 40, padding: "7px 10px" }}
                value={cada} inputMode="numeric" onChange={(e) => setCada(e.target.value)} aria-label="Intervalo" />
              <span style={{ fontSize: 14, color: "var(--apagado)" }}>{t.unidad}</span>
              <select className="entrada" style={{ minHeight: 40, padding: "7px 10px", fontFamily: "var(--texto)", fontSize: 14 }}
                value={puestoId} onChange={(e) => setPuestoId(e.target.value)} aria-label="Puesto">
                <option value="">sin puesto</option>
                {puestos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          ) : (
            <>
              <div className="fila mono" style={{ gap: 8, fontSize: 14, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: 22, color }}>{t.desde}</span>
                <span style={{ color: "var(--apagado)" }}>de {t.cada} {t.unidad}</span>
                {t.faltan > 0 ? (
                  <span style={{ color: "var(--tenue)" }}>· faltan {t.faltan}</span>
                ) : (
                  <span style={{ color: "var(--falla)" }}>· pasada por {Math.abs(t.faltan)}</span>
                )}
              </div>
              <div className="progreso">
                <span style={{ width: `${pct}%`, background: color }} />
              </div>
            </>
          )}
          {falla ? <span style={{ fontSize: 12.5, color: "var(--falla)" }}>{falla}</span> : null}
        </div>

        <div className="fila" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {editando ? (
            <>
              <button className="boton" style={{ padding: "9px 14px", minHeight: 44 }} onClick={guardar} disabled={ocupado}>Guardar</button>
              <button className="boton hueco" style={{ padding: "9px 14px", minHeight: 44 }} onClick={() => setEditando(false)}>Cancelar</button>
            </>
          ) : (
            <>
              <button className="boton" style={{ padding: "10px 16px", minHeight: 44 }} onClick={marcar} disabled={ocupado}>
                {ocupado ? "…" : "Ya la hice"}
              </button>
              <button className="boton hueco" style={{ padding: "10px 14px", minHeight: 44 }} onClick={() => setEditando(true)}>
                Ajustar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Los puestos: la gente rota, el puesto se queda. */
function Puestos({ puestos }: { puestos: Puesto[] }) {
  return (
    <div className="tarjeta pila" style={{ gap: 14, padding: "20px 24px 24px" }}>
      <div className="pila" style={{ gap: 4 }}>
        <span className="lbl">Puestos de la planta</span>
        <span style={{ fontSize: 13.5, color: "var(--apagado)", lineHeight: 1.45 }}>
          Las tareas se asignan a puestos, no a personas. Cuando alguien se va, entra otro al puesto
          y no hay que reasignar nada.
        </span>
      </div>
      <div className="fila" style={{ gap: 10, flexWrap: "wrap" }}>
        {puestos.length === 0 ? (
          <span style={{ fontSize: 14, color: "var(--tenue)" }}>Todavía no hay puestos cargados.</span>
        ) : (
          puestos.map((p) => (
            <div key={p.id} className="pila" style={{ gap: 2, border: "1px solid var(--linea)", padding: "10px 14px", minWidth: 200 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</span>
              <span style={{ fontSize: 12.5, color: "var(--tenue)", lineHeight: 1.4 }}>{p.description ?? ""}</span>
            </div>
          ))
        )}
      </div>
      <div className="fila" style={{ gap: 10 }}>
        <IconoInfo color="var(--tenue)" size={16} />
        <span style={{ fontSize: 13, color: "var(--tenue)" }}>
          Se pueden agregar y renombrar desde la API; la pantalla para editarlos queda pendiente.
        </span>
      </div>
    </div>
  );
}
