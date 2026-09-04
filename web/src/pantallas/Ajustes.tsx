import { useState } from "react";
import { api, type Ajuste } from "../api";
import { useApi } from "../usar";
import { Cargando, Fallo, IconoInfo } from "../comp/piezas";

/**
 * Todo se puede editar y se queda como el cliente lo deja.
 *
 * La tabla settings guarda ÚNICAMENTE lo que él cambió: "volver al valor de
 * fábrica" borra la fila, no copia el valor de fábrica encima. Así lo que él
 * tocó queda intocable y lo que nunca tocó puede recibir mejoras nuestras.
 *
 * La norma no se edita nunca y queda dibujada detrás, para que apartarse de
 * ella sea una decisión suya y no un descuido.
 */
export default function Ajustes() {
  const { dato, error, cargando, recargar } = useApi<Ajuste[]>("/bloques/ajustes");

  if (cargando) return <main className="lienzo"><Cargando que="los ajustes" /></main>;
  if (error) return <main className="lienzo"><Fallo error={error} /></main>;

  const ajustes = dato ?? [];
  const rangos = ajustes.filter((a) => a.tipo === "rango");
  const numeros = ajustes.filter((a) => a.tipo === "numero");

  return (
    <main className="lienzo">
      <div className="pila" style={{ gap: 10 }}>
        <h1 className="titulo">Rangos y valores</h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: "var(--apagado)", maxWidth: "68ch" }}>
          Todo lo de abajo viene con un valor de fábrica y todo se puede cambiar. Lo que usted ponga
          se queda tal cual: el sistema no lo corrige ni lo regresa solo al valor de fábrica. La
          referencia de norma queda dibujada detrás, para que se vea cuánto se está alejando de ella.
        </p>
      </div>

      <div className="tarjeta fila" style={{ gap: 18, padding: "14px 20px", flexWrap: "wrap" }}>
        <Leyenda color="var(--linea-suave)" borde="var(--linea)" texto="De fábrica" />
        <Leyenda color="var(--ambar)" texto="Puesto por usted" />
        <Leyenda color="var(--tinta)" alto={4} texto="Norma · no se edita" />
      </div>

      <div className="tarjeta pila">
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--linea)" }}>
          <span className="lbl">Rangos de mezcla</span>
        </div>
        {rangos.map((a, i) => (
          <FilaRango key={a.key} a={a} ultimo={i === rangos.length - 1} alCambiar={recargar} />
        ))}
      </div>

      <div className="tarjeta pila">
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--linea)" }}>
          <span className="lbl">Proceso y objetivo</span>
        </div>
        {numeros.map((a, i) => (
          <FilaNumero key={a.key} a={a} ultimo={i === numeros.length - 1} alCambiar={recargar} />
        ))}
      </div>

      <div className="aviso neutro">
        <IconoInfo color="var(--apagado)" />
        <span>
          Cambiar un rango cambia solo cuándo el sistema avisa. No cambia el bloque, y ninguna de
          estas cifras predice la resistencia: eso lo dice el ensayo.
        </span>
      </div>

      <ArrancarDeCero />
    </main>
  );
}

/**
 * El sistema se entrega con un lote de ejemplo para que se pueda ver
 * funcionando antes de que exista producción real. Ese lote no puede
 * quedarse: el primer lote de verdad tiene que ser el número 1, y el
 * historial de la planta no puede empezar con una corrida que nunca ocurrió.
 */
function ArrancarDeCero() {
  const [abierto, setAbierto] = useState(false);
  const [palabra, setPalabra] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{ lotes: number; ensayos: number; recetasDevueltasABorrador: number } | null>(null);

  async function borrar() {
    setOcupado(true); setFalla(null);
    try {
      const r = await api.post<{ lotes: number; ensayos: number; recetasDevueltasABorrador: number }>(
        "/bloques/reiniciar-produccion",
        { confirmacion: palabra },
      );
      setHecho(r);
      setPalabra("");
      setAbierto(false);
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally { setOcupado(false); }
  }

  return (
    <div className="tarjeta pila" style={{ gap: 14, padding: "22px 24px 24px", borderLeft: "3px solid var(--falla)" }}>
      <div className="pila" style={{ gap: 5 }}>
        <span className="lbl">Arrancar de cero</span>
        <span style={{ fontSize: 14, lineHeight: 1.5, color: "var(--apagado)", maxWidth: "70ch" }}>
          Borra <strong>todo el historial de producción</strong>: los lotes, lo que consumió cada uno,
          los ensayos y los registros de mantenimiento. La numeración de lotes vuelve a empezar en 1.
          No toca el catálogo, ni los precios, ni las recetas, ni los puestos, ni estos ajustes.
        </span>
        <span style={{ fontSize: 13.5, lineHeight: 1.45, color: "var(--tenue)", maxWidth: "70ch" }}>
          Las recetas vuelven a «borrador»: una receta está validada porque un ensayo la respalda, y
          si el ensayo se borra el respaldo deja de existir. Esto no se puede deshacer.
        </span>
      </div>

      {hecho ? (
        <div className="aviso neutro">
          <IconoInfo color="var(--apagado)" />
          <span>
            Listo. Se borraron {hecho.lotes} {hecho.lotes === 1 ? "lote" : "lotes"} y{" "}
            {hecho.ensayos} {hecho.ensayos === 1 ? "ensayo" : "ensayos"}
            {hecho.recetasDevueltasABorrador > 0
              ? `, y ${hecho.recetasDevueltasABorrador} ${hecho.recetasDevueltasABorrador === 1 ? "receta volvió" : "recetas volvieron"} a borrador`
              : ""}
            . El próximo lote será el número 1.
          </span>
        </div>
      ) : null}

      {!abierto ? (
        <button className="boton hueco" style={{ alignSelf: "flex-start", minHeight: 44, color: "var(--falla)", borderColor: "var(--falla)" }}
          onClick={() => { setAbierto(true); setHecho(null); }}>
          Borrar el historial de producción
        </button>
      ) : (
        <div className="pila" style={{ gap: 12 }}>
          <span style={{ fontSize: 14, lineHeight: 1.5 }}>
            Para confirmar, escriba <strong className="mono">BORRAR</strong> acá abajo.
          </span>
          <div className="fila" style={{ gap: 10, flexWrap: "wrap" }}>
            <input className="entrada" style={{ width: 180, minHeight: 44 }} value={palabra}
              onChange={(e) => setPalabra(e.target.value)} aria-label="Confirmación" placeholder="BORRAR" />
            <button className="boton" style={{ minHeight: 44, background: "var(--falla)", borderColor: "var(--falla)", color: "#000" }}
              onClick={borrar} disabled={ocupado || palabra !== "BORRAR"}>
              {ocupado ? "Borrando…" : "Borrar de verdad"}
            </button>
            <button className="boton hueco" style={{ minHeight: 44 }}
              onClick={() => { setAbierto(false); setPalabra(""); setFalla(null); }}>
              Cancelar
            </button>
          </div>
          {falla ? <span style={{ fontSize: 13, color: "var(--falla)" }}>{falla}</span> : null}
        </div>
      )}
    </div>
  );
}

function Leyenda({ color, borde, alto = 14, texto }: { color: string; borde?: string; alto?: number; texto: string }) {
  return (
    <div className="fila" style={{ gap: 9 }}>
      <span style={{ width: 14, height: alto, background: color, border: borde ? `1px solid ${borde}` : undefined }} />
      <span className="cond" style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--apagado)" }}>
        {texto}
      </span>
    </div>
  );
}

function FilaRango({ a, ultimo, alCambiar }: { a: Ajuste; ultimo: boolean; alCambiar: () => void }) {
  const v = a.valor as { min: number; max: number };
  const f = a.fabrica as { min: number; max: number };
  const [min, setMin] = useState(String(v.min));
  const [max, setMax] = useState(String(v.max));
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);

  const sucio = Number(min) !== v.min || Number(max) !== v.max;

  async function guardar() {
    setOcupado(true); setFalla(null);
    try {
      await api.put(`/bloques/ajustes/${a.key}`, { min: Number(min), max: Number(max) });
      alCambiar();
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally { setOcupado(false); }
  }

  async function volver() {
    setOcupado(true); setFalla(null);
    try {
      await api.del(`/bloques/ajustes/${a.key}`);
      setMin(String(f.min)); setMax(String(f.max));
      alCambiar();
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally { setOcupado(false); }
  }

  const n = a.norma;
  const normaTexto = n
    ? n.valor !== undefined
      ? `Norma: ${n.valor}`
      : `Norma: ${n.min ?? "—"} a ${n.max ?? "—"}`
    : null;
  const masAnchoQueLaNorma =
    n?.max !== undefined && v.max > n.max ? `La norma llega hasta ${n.max}. Arriba de ahí ya no avisa.` : null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(220px, 1.5fr) minmax(220px, 1.1fr) minmax(200px, 1fr)",
        gap: 22,
        alignItems: "center",
        padding: "20px 24px",
        borderBottom: ultimo ? "none" : "1px solid var(--linea-suave)",
        background: a.esDelCliente ? "var(--ambar-fondo)" : undefined,
      }}
    >
      <div className="pila" style={{ gap: 4 }}>
        <div className="fila" style={{ gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{a.etiqueta}</span>
          {a.esDelCliente ? <span className="insignia aviso">Puesto por usted</span> : null}
        </div>
        <span style={{ fontSize: 13.5, color: "var(--tenue)", lineHeight: 1.4 }}>
          {a.esDelCliente ? `De fábrica era ${f.min} a ${f.max}` : a.ayuda}
        </span>
      </div>

      <div className="fila" style={{ gap: 10, flexWrap: "wrap" }}>
        <input className={`entrada ${Number(min) !== f.min ? "tocada" : ""}`} style={{ width: 92 }}
          value={min} inputMode="decimal" onChange={(e) => setMin(e.target.value)} aria-label={`${a.etiqueta} mínimo`} />
        <span className="cond" style={{ fontSize: 15, color: "var(--tenue)" }}>a</span>
        <input className={`entrada ${Number(max) !== f.max ? "tocada" : ""}`} style={{ width: 92 }}
          value={max} inputMode="decimal" onChange={(e) => setMax(e.target.value)} aria-label={`${a.etiqueta} máximo`} />
        {sucio ? (
          <button className="boton" style={{ padding: "9px 14px", minHeight: 44 }} onClick={guardar} disabled={ocupado}>
            Guardar
          </button>
        ) : null}
      </div>

      <div className="pila" style={{ gap: 6 }}>
        <span style={{ fontSize: 13, lineHeight: 1.4, color: "var(--apagado)" }}>
          {masAnchoQueLaNorma ?? normaTexto ?? ""}
        </span>
        {n ? <span style={{ fontSize: 12, lineHeight: 1.35, color: "var(--tenue)" }}>{n.fuente}</span> : null}
        {a.esDelCliente ? (
          <button
            onClick={volver}
            disabled={ocupado}
            className="cond"
            style={{
              alignSelf: "flex-start", background: "none", border: "none", padding: 0, cursor: "pointer",
              fontSize: 13, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
              color: "var(--ambar-tinta)", borderBottom: "1px solid var(--ambar-tinta)",
            }}
          >
            Volver al valor de fábrica
          </button>
        ) : null}
        {falla ? <span style={{ fontSize: 13, color: "var(--falla)" }}>{falla}</span> : null}
      </div>
    </div>
  );
}

function FilaNumero({ a, ultimo, alCambiar }: { a: Ajuste; ultimo: boolean; alCambiar: () => void }) {
  const v = a.valor as number;
  const f = a.fabrica as number;
  const [texto, setTexto] = useState(String(v));
  const [ocupado, setOcupado] = useState(false);
  const sucio = Number(texto) !== v;

  const esMpa = a.key.includes("mpa_milli");
  const mostrado = esMpa ? String(Number(texto) / 1000) : texto;

  async function guardar(valor: number) {
    setOcupado(true);
    try {
      await api.put(`/bloques/ajustes/${a.key}`, { valor });
      alCambiar();
    } finally { setOcupado(false); }
  }

  return (
    <div
      style={{
        display: "grid", gridTemplateColumns: "minmax(220px, 1.5fr) minmax(220px, 1.1fr) minmax(200px, 1fr)",
        gap: 22, alignItems: "center", padding: "20px 24px",
        borderBottom: ultimo ? "none" : "1px solid var(--linea-suave)",
        background: a.esDelCliente ? "var(--ambar-fondo)" : undefined,
      }}
    >
      <div className="pila" style={{ gap: 4 }}>
        <div className="fila" style={{ gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{a.etiqueta}</span>
          {a.esDelCliente ? <span className="insignia aviso">Puesto por usted</span> : null}
        </div>
        <span style={{ fontSize: 13.5, color: "var(--tenue)", lineHeight: 1.4 }}>{a.ayuda}</span>
      </div>

      <div className="fila" style={{ gap: 10, flexWrap: "wrap" }}>
        <input
          className={`entrada ${Number(texto) !== f ? "tocada" : ""}`}
          style={{ width: 110 }}
          value={mostrado}
          inputMode="decimal"
          onChange={(e) => setTexto(esMpa ? String(Number(e.target.value) * 1000) : e.target.value)}
          aria-label={a.etiqueta}
        />
        {esMpa ? <span className="cond" style={{ fontSize: 15, color: "var(--apagado)" }}>MPa</span> : null}
        {sucio ? (
          <button className="boton" style={{ padding: "9px 14px", minHeight: 44 }} onClick={() => guardar(Number(texto))} disabled={ocupado}>
            Guardar
          </button>
        ) : null}
      </div>

      <div className="pila" style={{ gap: 6 }}>
        <span style={{ fontSize: 13, color: "var(--apagado)" }}>
          De fábrica {esMpa ? Number(f) / 1000 : f}{esMpa ? " MPa" : ""}
        </span>
        {a.esDelCliente ? (
          <button
            onClick={async () => { setOcupado(true); try { await api.del(`/bloques/ajustes/${a.key}`); setTexto(String(f)); alCambiar(); } finally { setOcupado(false); } }}
            disabled={ocupado}
            className="cond"
            style={{
              alignSelf: "flex-start", background: "none", border: "none", padding: 0, cursor: "pointer",
              fontSize: 13, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
              color: "var(--ambar-tinta)", borderBottom: "1px solid var(--ambar-tinta)",
            }}
          >
            Volver al valor de fábrica
          </button>
        ) : null}
      </div>
    </div>
  );
}
