import { useState } from "react";
import { api, fecha, type EstadoTarea, type Puesto, type Tablero, type TareaMantenimiento } from "../api";
import { useApi } from "../usar";
import { Campo, Cargando, Fallo, IconoAviso, IconoOk } from "../comp/piezas";

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
  const { dato: puestos, recargar: recargarPuestos } = useApi<Puesto[]>("/bloques/puestos");

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

      <NuevaTarea puestos={puestos ?? []} alCrear={recargar} />

      <div className="aviso ambar">
        <IconoAviso color="var(--ambar-tinta)" />
        <span>
          Los intervalos que trae el sistema son un punto de partida, no una verdad. Cada prensa trae
          su manual y ese manual manda: si el fabricante de su máquina dice otra cosa, cámbielo acá.
        </span>
      </div>

      <Puestos puestos={puestos ?? []} tareas={tareas} alCambiar={() => { recargarPuestos(); recargar(); }} />
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
  const [confirmandoQuitar, setConfirmandoQuitar] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);

  async function quitar() {
    setOcupado(true); setFalla(null);
    try {
      await api.del(`/bloques/mantenimiento/tareas/${t.id}`);
      alCambiar();
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
      setConfirmandoQuitar(false);
    } finally { setOcupado(false); }
  }

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
          ) : confirmandoQuitar ? (
            <>
              <button className="boton" style={{ padding: "10px 14px", minHeight: 44, background: "var(--falla)", borderColor: "var(--falla)", color: "#000" }}
                onClick={quitar} disabled={ocupado}>
                {ocupado ? "…" : t.esDeFabrica ? "Sí, desactivarla" : "Sí, quitarla"}
              </button>
              <button className="boton hueco" style={{ padding: "10px 14px", minHeight: 44 }}
                onClick={() => setConfirmandoQuitar(false)}>
                No
              </button>
            </>
          ) : (
            <>
              <button className="boton" style={{ padding: "10px 16px", minHeight: 44 }} onClick={marcar} disabled={ocupado}>
                {ocupado ? "…" : "Ya la hice"}
              </button>
              <button className="boton hueco" style={{ padding: "10px 14px", minHeight: 44 }} onClick={() => setEditando(true)}>
                Ajustar
              </button>
              {/*
                Las de fábrica se desactivan y las propias se quitan. La
                diferencia importa: una de fábrica desactivada puede volver
                cuando mejoremos el sistema; una propia es de la planta y se
                va del todo.
              */}
              <button onClick={() => setConfirmandoQuitar(true)} className="cond"
                style={{
                  background: "none", border: "none", padding: "0 4px", cursor: "pointer",
                  fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                  color: "var(--tenue)",
                }}>
                {t.esDeFabrica ? "Desactivar" : "Quitar"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Los puestos: la gente rota, el puesto se queda. */
function Puestos({
  puestos, tareas, alCambiar,
}: { puestos: Puesto[]; tareas: TareaMantenimiento[]; alCambiar: () => void }) {
  /** Un puesto con tareas encima no se puede quitar sin dejarlas huérfanas. */
  const conteoPorPuesto: Record<string, number> = {};
  for (const t of tareas) if (t.puesto) conteoPorPuesto[t.puesto.id] = (conteoPorPuesto[t.puesto.id] ?? 0) + 1;

  const [agregando, setAgregando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);

  async function crear() {
    if (nombre.trim() === "") return;
    setOcupado(true); setFalla(null);
    try {
      await api.post("/bloques/puestos", {
        code: codigoDe(nombre) || `puesto-${Date.now()}`,
        name: nombre.trim(),
        ...(descripcion.trim() ? { description: descripcion.trim() } : {}),
      });
      setNombre(""); setDescripcion(""); setAgregando(false);
      alCambiar();
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally { setOcupado(false); }
  }

  return (
    <div className="tarjeta pila" style={{ gap: 16, padding: "20px 24px 24px" }}>
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
            <FichaPuesto key={p.id} p={p} tareasAsignadas={conteoPorPuesto[p.id] ?? 0} alCambiar={alCambiar} />
          ))
        )}
      </div>

      {agregando ? (
        <div className="pila" style={{ gap: 12, borderTop: "1px solid var(--linea-suave)", paddingTop: 16 }}>
          <div className="rejilla uno-uno" style={{ gap: 14 }}>
            <Campo etiqueta="Nombre del puesto">
              <input className="entrada" style={{ minHeight: 44 }} value={nombre} placeholder="Encargado de planta"
                onChange={(e) => setNombre(e.target.value)} aria-label="Nombre del puesto" />
            </Campo>
            <Campo etiqueta="Qué hace" ayuda="Opcional.">
              <input className="entrada" style={{ minHeight: 44 }} value={descripcion} placeholder="Supervisa la corrida y firma los lotes"
                onChange={(e) => setDescripcion(e.target.value)} aria-label="Descripción del puesto" />
            </Campo>
          </div>
          {falla ? <span style={{ fontSize: 13, color: "var(--falla)" }}>{falla}</span> : null}
          <div className="fila" style={{ gap: 10, flexWrap: "wrap" }}>
            <button className="boton" style={{ minHeight: 44 }} onClick={crear} disabled={ocupado || nombre.trim() === ""}>
              {ocupado ? "…" : "Agregar el puesto"}
            </button>
            <button className="boton hueco" style={{ minHeight: 44 }} onClick={() => { setAgregando(false); setFalla(null); }}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button className="boton hueco" style={{ alignSelf: "flex-start", minHeight: 44 }} onClick={() => setAgregando(true)}>
          Agregar un puesto
        </button>
      )}
    </div>
  );
}

function FichaPuesto({
  p, tareasAsignadas, alCambiar,
}: { p: Puesto; tareasAsignadas: number; alCambiar: () => void }) {
  const [editando, setEditando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [nombre, setNombre] = useState(p.name);
  const [descripcion, setDescripcion] = useState(p.description ?? "");
  const [ocupado, setOcupado] = useState(false);

  async function quitar() {
    setOcupado(true);
    try {
      await api.del(`/bloques/puestos/${p.id}`);
      alCambiar();
    } finally { setOcupado(false); setConfirmando(false); }
  }

  async function guardar() {
    setOcupado(true);
    try {
      await api.patch(`/bloques/puestos/${p.id}`, {
        name: nombre.trim() || p.name,
        description: descripcion.trim(),
      });
      setEditando(false);
      alCambiar();
    } finally { setOcupado(false); }
  }

  if (editando) {
    return (
      <div className="pila" style={{ gap: 8, border: "1px solid var(--ambar)", padding: "12px 14px", minWidth: 260 }}>
        <input className="entrada" style={{ minHeight: 40 }} value={nombre}
          onChange={(e) => setNombre(e.target.value)} aria-label="Nombre del puesto" />
        <input className="entrada" style={{ minHeight: 40 }} value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)} aria-label="Descripción del puesto" />
        <div className="fila" style={{ gap: 8 }}>
          <button className="boton" style={{ padding: "8px 12px", minHeight: 40 }} onClick={guardar} disabled={ocupado}>
            Guardar
          </button>
          <button className="boton hueco" style={{ padding: "8px 12px", minHeight: 40 }} onClick={() => setEditando(false)}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pila" style={{ gap: 4, border: "1px solid var(--linea)", padding: "10px 14px", minWidth: 220 }}>
      <span style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</span>
      <span style={{ fontSize: 12.5, color: "var(--tenue)", lineHeight: 1.4 }}>{p.description ?? ""}</span>
      <span className="mono" style={{ fontSize: 11.5, color: "var(--tenue)" }}>
        {tareasAsignadas === 0
          ? "sin tareas asignadas"
          : `${tareasAsignadas} ${tareasAsignadas === 1 ? "tarea" : "tareas"}`}
      </span>
      <div className="fila" style={{ gap: 12, marginTop: 4 }}>
        <button onClick={() => setEditando(true)} className="cond" style={enlace}>
          Cambiar nombre
        </button>
        {tareasAsignadas === 0 ? (
          confirmando ? (
            <>
              <button onClick={quitar} disabled={ocupado} className="cond" style={{ ...enlace, color: "var(--falla)" }}>
                Sí, quitar
              </button>
              <button onClick={() => setConfirmando(false)} className="cond" style={enlace}>No</button>
            </>
          ) : (
            <button onClick={() => setConfirmando(true)} className="cond" style={enlace}>Quitar</button>
          )
        ) : null}
      </div>
    </div>
  );
}

const enlace: React.CSSProperties = {
  background: "none", border: "none", padding: 0, cursor: "pointer",
  fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
  color: "var(--apagado)",
};

/** El código sale del nombre: un campo menos que llenar y explicar. */
function codigoDe(texto: string): string {
  return texto.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

/**
 * Una tarea propia de la planta.
 *
 * Los siete que trae el sistema salieron de cómo funciona una bloquera en
 * general. La máquina de Amada va a tener las suyas —su manual manda— y esta
 * es la puerta para agregarlas sin pedirnos nada.
 */
function NuevaTarea({ puestos, alCrear }: { puestos: Puesto[]; alCrear: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [cada, setCada] = useState("");
  const [unidad, setUnidad] = useState<"mezclas" | "lotes">("mezclas");
  const [puestoId, setPuestoId] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);

  const cadaN = Number(cada);
  const listo = nombre.trim() !== "" && Number.isInteger(cadaN) && cadaN > 0;

  async function crear() {
    if (!listo) return;
    setOcupado(true); setFalla(null);
    try {
      await api.post("/bloques/mantenimiento/tareas", {
        code: codigoDe(nombre) || `tarea-${Date.now()}`,
        name: nombre.trim(),
        ...(descripcion.trim() ? { description: descripcion.trim() } : {}),
        ...(puestoId ? { roleId: puestoId } : {}),
        ...(unidad === "mezclas" ? { everyMixes: cadaN } : { everyBatches: cadaN }),
      });
      setNombre(""); setDescripcion(""); setCada(""); setPuestoId("");
      setAbierto(false);
      alCrear();
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally { setOcupado(false); }
  }

  if (!abierto) {
    return (
      <button className="boton hueco" style={{ alignSelf: "flex-start", minHeight: 44 }} onClick={() => setAbierto(true)}>
        Agregar una tarea propia de esta planta
      </button>
    );
  }

  return (
    <div className="tarjeta pila" style={{ gap: 18, padding: "22px 24px 24px" }}>
      <span className="lbl">Tarea nueva</span>

      <Campo etiqueta="Qué hay que hacer">
        <input className="entrada" style={{ minHeight: 44 }} value={nombre} placeholder="Engrasar las guías del molde"
          onChange={(e) => setNombre(e.target.value)} aria-label="Nombre de la tarea" />
      </Campo>

      <Campo etiqueta="Por qué importa" ayuda="Opcional, pero ayuda: quien la lee dentro de seis meses no va a acordarse.">
        <input className="entrada" style={{ minHeight: 44 }} value={descripcion}
          placeholder="Sin grasa las guías se traban y el molde baja disparejo."
          onChange={(e) => setDescripcion(e.target.value)} aria-label="Descripción de la tarea" />
      </Campo>

      <Campo
        etiqueta="Cada cuánto toca"
        ayuda="Se mide por uso de la máquina, no por calendario: una semana floja la ensucia menos que una de mucha producción."
      >
        <div className="fila" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 15, color: "var(--apagado)" }}>cada</span>
          <input className="entrada" style={{ width: 100, minHeight: 44, textAlign: "right" }} value={cada}
            inputMode="numeric" placeholder="10" onChange={(e) => setCada(e.target.value)} aria-label="Intervalo" />
          <select className="entrada" style={{ minHeight: 44, fontFamily: "var(--texto)", width: 130 }}
            value={unidad} onChange={(e) => setUnidad(e.target.value as "mezclas" | "lotes")} aria-label="Unidad del intervalo">
            <option value="mezclas">mezclas</option>
            <option value="lotes">lotes</option>
          </select>
        </div>
      </Campo>

      <Campo etiqueta="A qué puesto le toca">
        <select className="entrada" style={{ minHeight: 44, fontFamily: "var(--texto)" }}
          value={puestoId} onChange={(e) => setPuestoId(e.target.value)} aria-label="Puesto responsable">
          <option value="">— sin puesto asignado —</option>
          {puestos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Campo>

      {falla ? <div className="error">{falla}</div> : null}

      <div className="fila" style={{ gap: 10, flexWrap: "wrap" }}>
        <button className="boton" style={{ minHeight: 44 }} onClick={crear} disabled={!listo || ocupado}>
          {ocupado ? "Guardando…" : "Agregar la tarea"}
        </button>
        <button className="boton hueco" style={{ minHeight: 44 }} onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
