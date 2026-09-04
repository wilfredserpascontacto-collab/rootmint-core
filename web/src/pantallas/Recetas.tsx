import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, money, type Material, type RecetaFila, type TipoBloque } from "../api";
import { useApi } from "../usar";
import { Campo, Cargando, Fallo, IconoAviso, IconoInfo } from "../comp/piezas";

export default function Recetas() {
  const { dato, error, cargando, recargar } = useApi<RecetaFila[]>("/bloques/recetas");
  const { dato: materiales } = useApi<Material[]>("/bloques/materiales");
  const { dato: tipos } = useApi<TipoBloque[]>("/bloques/tipos");

  if (cargando) return <main className="lienzo"><Cargando que="las recetas" /></main>;
  if (error) return <main className="lienzo"><Fallo error={error} /></main>;

  const recetas = dato ?? [];
  const es = (s: string) => (s === "validated" ? "validada" : s === "retired" ? "retirada" : "borrador");

  return (
    <main className="lienzo">
      <h1 className="titulo">Recetas</h1>

      {recetas.length === 0 ? (
        <div className="aviso neutro">
          <IconoInfo color="var(--apagado)" />
          <span>
            Todavía no hay ninguna receta. Una receta dice qué lleva una mezcla y cuántos bloques
            salen de ella: es lo primero que hay que cargar para poder producir.
          </span>
        </div>
      ) : (
        <div className="tarjeta envoltura-tabla">
          <table className="tabla">
            <thead>
              <tr>
                <th>Receta</th><th>Bloque</th>
                <th className="num">Bloques por mezcla</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {recetas.map((r) => (
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
      )}

      <NuevaReceta materiales={materiales ?? []} tipos={tipos ?? []} alCrear={recargar} />

      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--apagado)", maxWidth: "68ch" }}>
        Una receta solo se vuelve <strong>validada</strong> cuando un lote suyo pasa el ensayo de
        resistencia. No se valida por decreto: eso convertiría el estado en decoración. Mientras
        tanto se puede correr como prueba, que es justamente de donde salen las probetas.
      </p>
    </main>
  );
}

interface Renglon {
  materialId: string;
  /** Texto crudo: se convierte a milésimas al enviar. */
  cantidad: string;
}

/**
 * Armar una receta.
 *
 * La cantidad de cada renglón va SIEMPRE en la unidad con que ese material se
 * dosifica en la planta —la que quedó fijada en el catálogo—, así que acá no
 * se elige unidad: se muestra. Dejar elegirla abriría la puerta a escribir
 * «2 baldes» de un material que se mide en carretillas, y el costo saldría
 * mal sin que nada lo delatara.
 */
function NuevaReceta({
  materiales, tipos, alCrear,
}: { materiales: Material[]; tipos: TipoBloque[]; alCrear: () => void }) {
  const navegar = useNavigate();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [tipoId, setTipoId] = useState("");
  const [porMezcla, setPorMezcla] = useState("");
  const [renglones, setRenglones] = useState<Renglon[]>([{ materialId: "", cantidad: "" }]);
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);

  const porId = new Map(materiales.map((m) => [m.id, m]));
  const usables = renglones.filter((r) => r.materialId !== "" && Number(r.cantidad.replace(",", ".")) > 0);
  const porMezclaN = Number(porMezcla);

  const repetidos = (() => {
    const vistos = new Set<string>();
    for (const r of usables) {
      if (vistos.has(r.materialId)) return true;
      vistos.add(r.materialId);
    }
    return false;
  })();

  const listo =
    nombre.trim() !== "" && tipoId !== "" &&
    Number.isInteger(porMezclaN) && porMezclaN > 0 &&
    usables.length > 0 && !repetidos;

  /** El costo por bloque, calculado acá mismo mientras se escribe. */
  const previa = (() => {
    if (usables.length === 0) return null;
    let total = 0;
    let hayCero = false;
    for (const r of usables) {
      const m = porId.get(r.materialId);
      if (!m) continue;
      if (m.purchasePriceCents === 0) hayCero = true;
      const cant = Number(r.cantidad.replace(",", ".")) * 1000;
      total += Math.round((cant * m.purchasePriceCents) / Math.max(1, m.contentPerPurchaseMilli));
    }
    return {
      totalCents: total,
      porBloqueCents: porMezclaN > 0 ? Math.round(total / porMezclaN) : null,
      hayCero,
    };
  })();

  function cambiar(i: number, campo: keyof Renglon, valor: string) {
    setRenglones((rs) => rs.map((r, j) => (j === i ? { ...r, [campo]: valor } : r)));
  }

  async function crear() {
    if (!listo) return;
    setOcupado(true); setFalla(null);
    try {
      const r = await api.post<{ receta: { id: string } }>("/bloques/recetas", {
        code: nombre.trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || `REC-${Date.now()}`,
        name: nombre.trim(),
        blockTypeId: tipoId,
        expectedBlocksPerMix: porMezclaN,
        renglones: usables.map((x) => ({
          materialId: x.materialId,
          quantityMilli: Math.round(Number(x.cantidad.replace(",", ".")) * 1000),
        })),
      });
      alCrear();
      navegar(`/recetas/${r.receta.id}`);
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
      setOcupado(false);
    }
  }

  if (!abierto) {
    return (
      <button className="boton" style={{ alignSelf: "flex-start", minHeight: 44 }} onClick={() => setAbierto(true)}>
        Armar una receta nueva
      </button>
    );
  }

  if (materiales.length === 0) {
    return (
      <div className="aviso ambar">
        <IconoAviso color="var(--ambar-tinta)" />
        <span>
          No hay materiales en el catálogo todavía. Una receta se arma con materiales, así que ese
          es el paso anterior.
        </span>
      </div>
    );
  }

  return (
    <div className="tarjeta pila" style={{ gap: 20, padding: "22px 24px 26px" }}>
      <span className="lbl">Receta nueva</span>

      <div className="rejilla uno-uno" style={{ gap: 16 }}>
        <Campo etiqueta="Cómo se le llama">
          <input className="entrada" style={{ minHeight: 44 }} value={nombre} placeholder="Mezcla estándar"
            onChange={(e) => setNombre(e.target.value)} aria-label="Nombre de la receta" />
        </Campo>
        <Campo etiqueta="Qué bloque produce">
          <select className="entrada" style={{ minHeight: 44, fontFamily: "var(--texto)" }}
            value={tipoId} onChange={(e) => setTipoId(e.target.value)} aria-label="Tipo de bloque">
            <option value="">— elija —</option>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Campo>
      </div>

      <Campo
        etiqueta="Cuántos bloques salen de una mezcla"
        ayuda="Al principio es una estimación. Cuando corran lotes de verdad, la ficha de cada lote va a mostrar cuántos salieron realmente contra este número."
      >
        <input className="entrada" style={{ width: 140, minHeight: 44 }} value={porMezcla} inputMode="numeric"
          placeholder="60" onChange={(e) => setPorMezcla(e.target.value)} aria-label="Bloques por mezcla" />
      </Campo>

      <div className="pila" style={{ gap: 12 }}>
        <span className="lbl">Qué lleva una mezcla</span>
        {renglones.map((r, i) => {
          const m = porId.get(r.materialId);
          return (
            <div key={i} className="fila" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <select className="entrada" style={{ flex: "2 1 220px", minHeight: 44, fontFamily: "var(--texto)" }}
                value={r.materialId} onChange={(e) => cambiar(i, "materialId", e.target.value)}
                aria-label={`Material ${i + 1}`}>
                <option value="">— material —</option>
                {materiales.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <input className="entrada" style={{ flex: "0 1 110px", minHeight: 44, textAlign: "right" }}
                value={r.cantidad} inputMode="decimal" placeholder="4"
                onChange={(e) => cambiar(i, "cantidad", e.target.value)} aria-label={`Cantidad ${i + 1}`} />
              <span className="mono" style={{ minWidth: 92, fontSize: 14, color: m ? "var(--apagado)" : "var(--tenue)" }}>
                {m ? (m.unidadDosificacion ?? "sin unidad") : "—"}
              </span>
              {renglones.length > 1 ? (
                <button className="boton hueco" style={{ padding: "9px 14px", minHeight: 44 }}
                  onClick={() => setRenglones((rs) => rs.filter((_, j) => j !== i))} aria-label="Quitar renglón">
                  Quitar
                </button>
              ) : null}
            </div>
          );
        })}
        <button className="boton hueco" style={{ alignSelf: "flex-start", minHeight: 44 }}
          onClick={() => setRenglones((rs) => [...rs, { materialId: "", cantidad: "" }])}>
          Agregar otro material
        </button>
      </div>

      {repetidos ? (
        <div className="aviso ambar">
          <IconoAviso color="var(--ambar-tinta)" />
          <span>Hay un material repetido. Póngalo una sola vez, sumando la cantidad.</span>
        </div>
      ) : null}

      {previa ? (
        <div className="tarjeta fuerte pila" style={{ gap: 8, padding: "18px 22px" }}>
          <span className="lbl">Costo del material, con los precios de hoy</span>
          <div className="fila" style={{ gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
            <span className="cifra mono" style={{ fontSize: 34 }}>
              {previa.porBloqueCents !== null ? money(previa.porBloqueCents) : "—"}
            </span>
            <span className="mono" style={{ fontSize: 14, color: "var(--apagado)" }}>
              por bloque · {money(previa.totalCents)} la mezcla
              {porMezclaN > 0 ? ` ÷ ${porMezclaN}` : ""}
            </span>
          </div>
          {previa.hayCero ? (
            <span style={{ fontSize: 13.5, color: "var(--falla)", lineHeight: 1.45 }}>
              Hay un material sin precio cargado. Ese cero no es gratis: hace que el bloque parezca
              más barato de lo que es.
            </span>
          ) : (
            <span style={{ fontSize: 13, color: "var(--tenue)", lineHeight: 1.45 }}>
              Es solo el material. No incluye mano de obra, energía, moldes ni desperdicio.
            </span>
          )}
        </div>
      ) : null}

      {falla ? <div className="error">{falla}</div> : null}

      <div className="fila" style={{ gap: 10, flexWrap: "wrap" }}>
        <button className="boton" style={{ minHeight: 44 }} onClick={crear} disabled={!listo || ocupado}>
          {ocupado ? "Guardando…" : "Crear la receta"}
        </button>
        <button className="boton hueco" style={{ minHeight: 44 }} onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
