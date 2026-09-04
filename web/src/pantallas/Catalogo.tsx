import { useState } from "react";
import { api, cantidad, money, type Material, type Unidad } from "../api";
import { useApi } from "../usar";
import { Campo, Cargando, Fallo, IconoAviso, IconoInfo } from "../comp/piezas";

/**
 * El catálogo de materiales.
 *
 * Cambiar un precio acá NO recalcula ningún lote ya cerrado: cada lote guardó
 * el precio del día en que se corrió. Lo que sí se mueve es el costo teórico
 * de las recetas, que es de hoy.
 */
export default function Catalogo() {
  const { dato, error, cargando, recargar } = useApi<Material[]>("/bloques/materiales");
  const { dato: unidades } = useApi<Unidad[]>("/bloques/unidades");

  if (cargando) return <main className="lienzo"><Cargando que="el catálogo" /></main>;
  if (error) return <main className="lienzo"><Fallo error={error} /></main>;

  const materiales = dato ?? [];
  const sinPrecio = materiales.filter((m) => m.purchasePriceCents === 0);

  return (
    <main className="lienzo">
      <div className="fila" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
        <h1 className="titulo">Catálogo de materiales</h1>
        <span className="mono" style={{ fontSize: 13, color: "var(--apagado)" }}>
          {materiales.length} {materiales.length === 1 ? "material" : "materiales"}
        </span>
      </div>

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

      <NuevoMaterial unidades={unidades ?? []} alCrear={recargar} />

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

/**
 * Agregar un material.
 *
 * El campo que se presta a confusión es el de equivalencia. Un material se
 * COMPRA en una unidad (el metro cúbico de arena, la bolsa de cemento) y se
 * DOSIFICA en otra (la carretilla, la bolsa). El costo del bloque sale de
 * dividir el precio de compra entre cuántas unidades de dosificación caben en
 * una de compra. Si ese número está mal, todo el costo está mal, así que el
 * formulario lo pregunta con todas las letras y muestra el resultado.
 */
function NuevoMaterial({ unidades, alCrear }: { unidades: Unidad[]; alCrear: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [categoria, setCategoria] = useState("");
  const [unidadCompra, setUnidadCompra] = useState("");
  const [precio, setPrecio] = useState("");
  const [dosingUnitId, setDosingUnitId] = useState("");
  const [equivale, setEquivale] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);

  const precioCents = Math.round(Number(precio.replace(",", ".")) * 100);
  const equivaleN = Number(equivale.replace(",", "."));
  const dosing = unidades.find((u) => u.id === dosingUnitId);

  const listo =
    nombre.trim() !== "" &&
    unidadCompra.trim() !== "" &&
    Number.isFinite(precioCents) && precioCents >= 0 &&
    dosingUnitId !== "" &&
    Number.isFinite(equivaleN) && equivaleN > 0;

  const porUnidad = listo && precioCents > 0 ? precioCents / equivaleN : null;

  function limpiar() {
    setNombre(""); setCategoria(""); setUnidadCompra(""); setPrecio("");
    setDosingUnitId(""); setEquivale(""); setFalla(null);
  }

  async function crear() {
    if (!listo) return;
    setOcupado(true); setFalla(null);
    try {
      await api.post("/bloques/materiales", {
        // El código sale del nombre: un campo menos que llenar y explicar.
        code: nombre.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `material-${Date.now()}`,
        name: nombre.trim(),
        ...(categoria.trim() ? { category: categoria.trim() } : {}),
        purchaseUnit: unidadCompra.trim(),
        purchasePriceCents: precioCents,
        dosingUnitId,
        contentPerPurchaseMilli: Math.round(equivaleN * 1000),
      });
      limpiar();
      setAbierto(false);
      alCrear();
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally { setOcupado(false); }
  }

  if (!abierto) {
    return (
      <button className="boton hueco" style={{ alignSelf: "flex-start", minHeight: 44 }} onClick={() => setAbierto(true)}>
        Agregar un material
      </button>
    );
  }

  return (
    <div className="tarjeta pila" style={{ gap: 18, padding: "22px 24px 24px" }}>
      <span className="lbl">Material nuevo</span>

      <div className="rejilla uno-uno" style={{ gap: 16 }}>
        <Campo etiqueta="Nombre">
          <input className="entrada" style={{ minHeight: 44 }} value={nombre} placeholder="Arena de río"
            onChange={(e) => setNombre(e.target.value)} aria-label="Nombre del material" />
        </Campo>
        <Campo etiqueta="Categoría" ayuda="Opcional. Sirve para agrupar: agregado, cemento, aditivo.">
          <input className="entrada" style={{ minHeight: 44 }} value={categoria} placeholder="agregado"
            onChange={(e) => setCategoria(e.target.value)} aria-label="Categoría" />
        </Campo>
      </div>

      <div className="rejilla uno-uno" style={{ gap: 16 }}>
        <Campo etiqueta="Se compra por" ayuda="Como se lo factura el proveedor: m³, bolsa de 42.5 kg, quintal.">
          <input className="entrada" style={{ minHeight: 44 }} value={unidadCompra} placeholder="m³"
            onChange={(e) => setUnidadCompra(e.target.value)} aria-label="Unidad de compra" />
        </Campo>
        <Campo etiqueta="Precio de esa unidad">
          <div className="fila" style={{ gap: 8 }}>
            <span style={{ color: "var(--apagado)", fontSize: 16 }}>$</span>
            <input className="entrada" style={{ flex: 1, minWidth: 0, minHeight: 44 }} value={precio}
              inputMode="decimal" placeholder="28.00" onChange={(e) => setPrecio(e.target.value)} aria-label="Precio" />
          </div>
        </Campo>
      </div>

      <Campo
        etiqueta="Con qué se mide en la planta"
        ayuda="La unidad con la que el operario dosifica la mezcla: carretillas, baldes, bolsas, litros."
      >
        <select className="entrada" style={{ minHeight: 44, fontFamily: "var(--texto)" }}
          value={dosingUnitId} onChange={(e) => setDosingUnitId(e.target.value)} aria-label="Unidad de dosificación">
          <option value="">— elija —</option>
          {unidades.map((u) => (
            <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>
          ))}
        </select>
      </Campo>

      <Campo etiqueta={`Cuántas ${dosing ? dosing.name.toLowerCase() + "s" : "unidades"} salen de ${unidadCompra.trim() ? `1 ${unidadCompra.trim()}` : "una unidad de compra"}`}>
        <input className="entrada" style={{ width: 140, minHeight: 44 }} value={equivale} inputMode="decimal"
          placeholder="11" onChange={(e) => setEquivale(e.target.value)} aria-label="Equivalencia" />
        {porUnidad !== null && dosing ? (
          <span className="mono" style={{ fontSize: 14 }}>
            Sale a ${(porUnidad / 100).toFixed(4)} por {dosing.abbreviation}
          </span>
        ) : (
          <span style={{ fontSize: 13, color: "var(--tenue)", lineHeight: 1.45 }}>
            De este número sale el costo del bloque. Si está mal, todo el costo está mal: vale la pena
            medirlo una vez de verdad en vez de estimarlo.
          </span>
        )}
      </Campo>

      {falla ? <div className="error">{falla}</div> : null}

      <div className="fila" style={{ gap: 10, flexWrap: "wrap" }}>
        <button className="boton" style={{ minHeight: 44 }} onClick={crear} disabled={!listo || ocupado}>
          {ocupado ? "Guardando…" : "Agregar al catálogo"}
        </button>
        <button className="boton hueco" style={{ minHeight: 44 }} onClick={() => { setAbierto(false); limpiar(); }}>
          Cancelar
        </button>
      </div>
    </div>
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
