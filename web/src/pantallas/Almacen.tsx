import { useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { api, cantidad, fecha, milli, money, moneyFino, type Material } from "../api";
import { useApi } from "../usar";
import { Campo, Cargando, Fallo, IconoAviso, IconoInfo } from "../comp/piezas";
import { useModulos } from "../acceso/modulos";

/**
 * El almacén de materia prima.
 *
 * Cuatro cosas: lo que hay (existencias), lo que se pide y llega (compras), lo
 * que se cuenta con la mano (conteos) y a quién se le compra (proveedores).
 * La existencia nunca se escribe: sale de sumar movimientos. Si no cuadra, se
 * cuenta y se aprueba el conteo; nadie "edita" un saldo.
 */

// --- Utilidades ------------------------------------------------------------

/** "40,5" y "40.5" valen lo mismo. Vacío o basura → NaN. */
function numero(t: string): number {
  const limpio = t.trim().replace(",", ".");
  return limpio === "" ? NaN : Number(limpio);
}
const aMilli = (t: string) => Math.round(numero(t) * 1000);
const aCentavos = (t: string) => Math.round(numero(t) * 100);
const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Avisos({ lista }: { lista: string[] }) {
  if (lista.length === 0) return null;
  return (
    <div className="aviso" style={{ marginTop: 16 }}>
      <IconoAviso />
      <div className="pila" style={{ gap: 4 }}>
        {lista.map((a, i) => <span key={i}>{a}</span>)}
      </div>
    </div>
  );
}

function Falla({ texto }: { texto: string | null }) {
  return texto ? <div className="error" role="alert" style={{ marginTop: 12 }}>{texto}</div> : null;
}

/** Confirmar algo que no se deshace sin dejar rastro: pide el motivo. */
function ConMotivo({
  etiqueta, confirmar, ayuda, alConfirmar, deshabilitado,
}: {
  etiqueta: string;
  confirmar: string;
  ayuda?: string;
  alConfirmar: (motivo: string) => Promise<void>;
  deshabilitado?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);

  if (!abierto) {
    return (
      <button type="button" className="boton hueco" disabled={deshabilitado} onClick={() => setAbierto(true)}>
        {etiqueta}
      </button>
    );
  }
  return (
    <div className="pila c-confirmar" style={{ gap: 10, maxWidth: 460 }}>
      <Campo etiqueta="Motivo" ayuda={ayuda}>
        <input className="entrada" aria-label={`Motivo: ${etiqueta}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </Campo>
      <div className="fila" style={{ gap: 10 }}>
        <button
          type="button"
          className="boton"
          disabled={ocupado || motivo.trim().length < 3}
          onClick={async () => {
            setOcupado(true);
            setFalla(null);
            try {
              await alConfirmar(motivo.trim());
              setAbierto(false);
              setMotivo("");
            } catch (e) {
              setFalla(mensaje(e));
            } finally {
              setOcupado(false);
            }
          }}
        >
          {confirmar}
        </button>
        <button type="button" className="boton hueco" onClick={() => { setAbierto(false); setFalla(null); }}>
          No
        </button>
      </div>
      <Falla texto={falla} />
    </div>
  );
}

const ESTADO_COMPRA: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: "Pendiente", clase: "aviso" },
  parcial: { texto: "Llegó una parte", clase: "aviso" },
  completa: { texto: "Completa", clase: "cumple" },
  cerrada: { texto: "Cerrada", clase: "hueca" },
  cancelada: { texto: "Cancelada", clase: "hueca" },
};

function useEscribe() {
  const { persona } = useModulos();
  return { puede: persona?.role !== "viewer", duena: persona?.role === "owner" };
}

// --- Contenedor con pestañas ----------------------------------------------

export default function Almacen() {
  return (
    <main className="lienzo">
      <h1 className="titulo">ALMACÉN</h1>
      <nav className="fila" style={{ gap: 8, margin: "14px 0 22px", flexWrap: "wrap" }} aria-label="Secciones del almacén">
        {[
          ["/almacen", "Existencias", true],
          ["/almacen/compras", "Compras", false],
          ["/almacen/conteos", "Conteos", false],
          ["/almacen/proveedores", "Proveedores", false],
        ].map(([a, t, fin]) => (
          <NavLink key={String(a)} to={String(a)} end={Boolean(fin)} className={({ isActive }) => (isActive ? "boton" : "boton hueco")}>
            {String(t)}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Existencias />} />
        <Route path="compras" element={<Compras />} />
        <Route path="compras/nueva" element={<NuevaCompra />} />
        <Route path="compras/:id" element={<FichaCompra />} />
        <Route path="conteos" element={<Conteos />} />
        <Route path="conteos/:id" element={<FichaConteo />} />
        <Route path="proveedores" element={<Proveedores />} />
        <Route path="*" element={<Navigate to="/almacen" replace />} />
      </Routes>
    </main>
  );
}

// --- Existencias -----------------------------------------------------------

interface Fila {
  materialId: string;
  code: string;
  name: string;
  category: string | null;
  unidad: string;
  existenciaMilli: number;
  minStockMilli: number | null;
  bajoMinimo: boolean;
  porRecibirMilli: number;
  ultimoCostoUnidadCents: number | null;
  ultimaCompraEn: string | null;
  valorCents: number | null;
}
interface Resumen {
  materiales: Fila[];
  totales: { valorCents: number; sinCosto: number; bajoMinimo: number; negativos: number };
}
interface Movimiento {
  id: string;
  quantityMilli: number;
  reason: string;
  note: string | null;
  notedAt: string | null;
  createdAt: string;
}

const MOTIVO: Record<string, string> = {
  compra: "Compra",
  consumo: "Consumo de lote",
  ajuste: "Ajuste",
  merma: "Merma",
  devolucion: "Devolución",
};

function Existencias() {
  const { dato, error, cargando, recargar } = useApi<Resumen>("/bloques/almacen/materiales");
  const [abierto, setAbierto] = useState<string | null>(null);
  const { puede } = useEscribe();

  if (cargando && !dato) return <Cargando que="las existencias" />;
  if (error) return <Fallo error={error} />;
  if (!dato) return null;
  const t = dato.totales;

  return (
    <>
      <div className="rejilla uno-uno" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 16, marginBottom: 20 }}>
        <div className="tarjeta" style={{ padding: 16 }}>
          <span className="lbl">Valor en almacén</span>
          <div className="cifra grande">{money(t.valorCents)}</div>
          {t.sinCosto > 0 ? (
            <span style={{ fontSize: 13, color: "var(--apagado)" }}>
              {t.sinCosto} {t.sinCosto === 1 ? "material" : "materiales"} sin costo no se suman
            </span>
          ) : null}
        </div>
        <div className="tarjeta" style={{ padding: 16 }}>
          <span className="lbl">Bajo su mínimo</span>
          <div className="cifra grande">{t.bajoMinimo}</div>
        </div>
        <div className="tarjeta" style={{ padding: 16 }}>
          <span className="lbl">En negativo</span>
          <div className="cifra grande">{t.negativos}</div>
          {t.negativos > 0 ? <span style={{ fontSize: 13, color: "var(--apagado)" }}>Se usó más de lo que se anotó</span> : null}
        </div>
      </div>

      {dato.materiales.length === 0 ? (
        <div className="aviso"><IconoInfo /><span>Todavía no hay materiales. Se crean en el Catálogo.</span></div>
      ) : (
        <div className="tarjeta envoltura-tabla">
          <table className="tabla">
            <thead>
              <tr>
                <th>Material</th>
                <th className="num">Hay</th>
                <th className="num">Por llegar</th>
                <th className="num">Mínimo</th>
                <th className="num">Costo por unidad</th>
                <th className="num">Valor</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dato.materiales.map((m) => (
                <FilaExistencia
                  key={m.materialId}
                  m={m}
                  abierto={abierto === m.materialId}
                  puede={puede}
                  alAbrir={() => setAbierto(abierto === m.materialId ? null : m.materialId)}
                  alCambiar={recargar}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function FilaExistencia({
  m, abierto, puede, alAbrir, alCambiar,
}: { m: Fila; abierto: boolean; puede: boolean; alAbrir: () => void; alCambiar: () => void }) {
  const negativo = m.existenciaMilli < 0;
  return (
    <>
      <tr>
        <td>
          <strong>{m.name}</strong>
          <div style={{ fontSize: 13, color: "var(--apagado)" }}>{m.category ?? m.code}</div>
        </td>
        <td className="num" style={negativo ? { color: "var(--falla)" } : undefined}>
          {cantidad(m.existenciaMilli, m.unidad)}
          {negativo ? <div style={{ fontSize: 12 }}>negativo</div> : null}
          {m.bajoMinimo && !negativo ? <div><span className="insignia aviso">Bajo mínimo</span></div> : null}
        </td>
        <td className="num">{m.porRecibirMilli > 0 ? cantidad(m.porRecibirMilli, m.unidad) : "—"}</td>
        <td className="num">{m.minStockMilli !== null ? cantidad(m.minStockMilli, m.unidad) : "—"}</td>
        <td className="num">{m.ultimoCostoUnidadCents !== null ? moneyFino(m.ultimoCostoUnidadCents) : "sin costo"}</td>
        <td className="num">{m.valorCents !== null ? money(m.valorCents) : "—"}</td>
        <td>
          <button type="button" className="boton hueco" style={{ minHeight: 36, padding: "6px 12px" }} onClick={alAbrir}>
            {abierto ? "Cerrar" : "Detalle"}
          </button>
        </td>
      </tr>
      {abierto ? (
        <tr>
          <td colSpan={7} style={{ background: "var(--superficie-alta)" }}>
            <DetalleMaterial m={m} puede={puede} alCambiar={alCambiar} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function DetalleMaterial({ m, puede, alCambiar }: { m: Fila; puede: boolean; alCambiar: () => void }) {
  const { dato, error, cargando, recargar } = useApi<Movimiento[]>(`/bloques/almacen/materiales/${m.materialId}/movimientos`);
  const [tipo, setTipo] = useState<"sumar" | "restar" | "merma">("restar");
  const [cant, setCant] = useState("");
  const [nota, setNota] = useState("");
  const [min, setMin] = useState(m.minStockMilli !== null ? String(m.minStockMilli / 1000) : "");
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);

  const q = numero(cant);
  const listo = Number.isFinite(q) && q > 0 && nota.trim().length >= 3;

  async function ajustar() {
    if (!listo || ocupado) return;
    setOcupado(true);
    setFalla(null);
    try {
      const r = await api.post<{ avisos?: string[] }>("/bloques/almacen/ajuste", {
        materialId: m.materialId,
        quantityMilli: tipo === "sumar" ? aMilli(cant) : -aMilli(cant),
        reason: tipo === "merma" ? "merma" : "ajuste",
        note: nota.trim(),
      });
      setAvisos(r.avisos ?? []);
      setCant("");
      setNota("");
      recargar();
      alCambiar();
    } catch (e) {
      setFalla(mensaje(e));
    } finally {
      setOcupado(false);
    }
  }

  async function guardarMinimo() {
    setOcupado(true);
    setFalla(null);
    try {
      const v = numero(min);
      await api.patch(`/bloques/almacen/materiales/${m.materialId}/minimo`, {
        minStockMilli: Number.isFinite(v) ? aMilli(min) : null,
      });
      alCambiar();
    } catch (e) {
      setFalla(mensaje(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="pila" style={{ gap: 18, padding: "6px 0" }}>
      {puede ? (
        <div className="rejilla" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 24 }}>
          <div className="pila" style={{ gap: 10 }}>
            <span className="lbl">Corregir lo que hay</span>
            <select className="entrada" aria-label="Tipo de ajuste" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
              <option value="restar">Hay menos de lo anotado (restar)</option>
              <option value="sumar">Hay más de lo anotado (sumar)</option>
              <option value="merma">Se perdió o se dañó (merma)</option>
            </select>
            <input className="entrada" aria-label={`Cantidad en ${m.unidad}`} inputMode="decimal" placeholder={`Cantidad en ${m.unidad}`} value={cant} onChange={(e) => setCant(e.target.value)} />
            <input className="entrada" aria-label="Por qué" placeholder="Por qué (obligatorio)" value={nota} onChange={(e) => setNota(e.target.value)} />
            <button type="button" className="boton" disabled={!listo || ocupado} onClick={ajustar}>Anotar ajuste</button>
          </div>
          <div className="pila" style={{ gap: 10 }}>
            <span className="lbl">Mínimo para avisar que hay que comprar</span>
            <input className="entrada" aria-label={`Mínimo en ${m.unidad}`} inputMode="decimal" placeholder={`En ${m.unidad} (vacío = sin mínimo)`} value={min} onChange={(e) => setMin(e.target.value)} />
            <button type="button" className="boton hueco" disabled={ocupado} onClick={guardarMinimo}>Guardar mínimo</button>
          </div>
        </div>
      ) : null}
      <Falla texto={falla} />
      <Avisos lista={avisos} />

      <div className="pila" style={{ gap: 6 }}>
        <span className="lbl">Últimos movimientos</span>
        {cargando && !dato ? <Cargando que="los movimientos" /> : null}
        {error ? <Fallo error={error} /> : null}
        {dato && dato.length === 0 ? <span style={{ color: "var(--apagado)" }}>Todavía no se ha movido nada.</span> : null}
        {dato && dato.length > 0 ? (
          <div className="envoltura-tabla">
            <table className="tabla">
              <tbody>
                {dato.slice(0, 15).map((x) => (
                  <tr key={x.id}>
                    <td className="c-nw">{fecha(x.notedAt ?? x.createdAt)}</td>
                    <td>{MOTIVO[x.reason] ?? x.reason}</td>
                    <td className="num" style={{ color: x.quantityMilli < 0 ? "var(--falla)" : undefined }}>
                      {x.quantityMilli > 0 ? "+" : ""}{cantidad(x.quantityMilli, m.unidad)}
                    </td>
                    <td style={{ color: "var(--apagado)" }}>{x.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// --- Compras ---------------------------------------------------------------

interface CompraFila {
  id: string;
  number: number;
  supplierName: string;
  orderedOn: string;
  documentRef: string | null;
  estado: string;
  totalCents: number;
  recibidoCents: number;
}

function Compras() {
  const { dato, error, cargando } = useApi<CompraFila[]>("/bloques/compras");
  const { puede } = useEscribe();
  if (cargando) return <Cargando que="las compras" />;
  if (error) return <Fallo error={error} />;
  const filas = dato ?? [];
  return (
    <>
      <div className="fila" style={{ justifyContent: "space-between", marginBottom: 16, gap: 16, flexWrap: "wrap" }}>
        <span style={{ color: "var(--apagado)" }}>
          Pedir una compra no mete nada al almacén: entra cuando anotás que llegó.
        </span>
        {puede ? <Link to="/almacen/compras/nueva" className="boton">Nueva compra</Link> : null}
      </div>
      {filas.length === 0 ? (
        <div className="aviso"><IconoInfo /><span>Todavía no hay compras.</span></div>
      ) : (
        <div className="tarjeta envoltura-tabla">
          <table className="tabla">
            <thead>
              <tr><th>N°</th><th>Fecha</th><th>Proveedor</th><th>Estado</th><th className="num">Total</th><th className="num">Recibido</th></tr>
            </thead>
            <tbody>
              {filas.map((c) => {
                const e = ESTADO_COMPRA[c.estado] ?? { texto: c.estado, clase: "hueca" };
                return (
                  <tr key={c.id}>
                    <td><Link to={`/almacen/compras/${c.id}`}>Compra {c.number}</Link></td>
                    <td className="c-nw">{fecha(c.orderedOn)}</td>
                    <td>{c.supplierName}{c.documentRef ? <span style={{ color: "var(--apagado)" }}> · {c.documentRef}</span> : null}</td>
                    <td><span className={`insignia ${e.clase}`}>{e.texto}</span></td>
                    <td className="num">{money(c.totalCents)}</td>
                    <td className="num">{money(c.recibidoCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

interface Proveedor {
  id: string;
  name: string;
  nit: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
}

interface RenglonNuevo { materialId: string; cantidad: string; costo: string }

function NuevaCompra() {
  const nav = useNavigate();
  const { dato: provs } = useApi<Proveedor[]>("/bloques/proveedores");
  const { dato: mats } = useApi<Material[]>("/bloques/materiales");
  const [proveedor, setProveedor] = useState("");
  const [ref, setRef] = useState("");
  const [renglones, setRenglones] = useState<RenglonNuevo[]>([{ materialId: "", cantidad: "", costo: "" }]);
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);

  const activos = (provs ?? []).filter((p) => p.active);
  const materiales = (mats ?? []).filter((m) => m.active);
  const cambiar = (i: number, parte: Partial<RenglonNuevo>) =>
    setRenglones((rs) => rs.map((r, j) => (j === i ? { ...r, ...parte } : r)));

  const completos = renglones.filter((r) => r.materialId && Number.isFinite(numero(r.cantidad)) && numero(r.cantidad) > 0);
  const listo = proveedor !== "" && completos.length > 0 && completos.length === renglones.length;
  const total = completos.reduce((a, r) => {
    const m = materiales.find((x) => x.id === r.materialId);
    const precio = r.costo.trim() !== "" ? aCentavos(r.costo) : (m?.purchasePriceCents ?? 0);
    return a + Math.round((aMilli(r.cantidad) * precio) / 1000);
  }, 0);

  async function crear() {
    if (!listo || ocupado) return;
    setOcupado(true);
    setFalla(null);
    try {
      const r = await api.post<{ id: string }>("/bloques/compras", {
        supplierId: proveedor,
        ...(ref.trim() ? { documentRef: ref.trim() } : {}),
        lines: renglones.map((l) => ({
          materialId: l.materialId,
          quantityMilli: aMilli(l.cantidad),
          ...(l.costo.trim() !== "" && Number.isFinite(numero(l.costo)) ? { unitCostCents: aCentavos(l.costo) } : {}),
        })),
      });
      nav(`/almacen/compras/${r.id}`);
    } catch (e) {
      setFalla(mensaje(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="pila" style={{ gap: 18 }}>
      <Link to="/almacen/compras" className="lbl" style={{ textDecoration: "none" }}>← Compras</Link>
      <h2 className="titulo" style={{ fontSize: 24 }}>Nueva compra</h2>
      {provs && activos.length === 0 ? (
        <div className="aviso"><IconoInfo /><span>Primero hay que dar de alta un proveedor, en la pestaña Proveedores.</span></div>
      ) : null}
      <div className="tarjeta" style={{ padding: 18 }}>
        <div className="rejilla" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
          <Campo etiqueta="Proveedor">
            <select className="entrada" aria-label="Proveedor" value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
              <option value="">Elegí uno…</option>
              {activos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="N° de pedido o cotización (opcional)">
            <input className="entrada" aria-label="N° de pedido" value={ref} onChange={(e) => setRef(e.target.value)} />
          </Campo>
        </div>
      </div>

      <div className="tarjeta envoltura-tabla">
        <table className="tabla">
          <thead>
            <tr><th>Material</th><th className="num">Cantidad</th><th className="num">Precio por unidad de compra</th><th /></tr>
          </thead>
          <tbody>
            {renglones.map((r, i) => {
              const m = materiales.find((x) => x.id === r.materialId);
              return (
                <tr key={i}>
                  <td>
                    <select className="entrada" aria-label={`Material ${i + 1}`} value={r.materialId} onChange={(e) => cambiar(i, { materialId: e.target.value })}>
                      <option value="">Elegí un material…</option>
                      {materiales.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </td>
                  <td className="num">
                    <input className="entrada" style={{ width: 110 }} aria-label={`Cantidad ${i + 1}`} inputMode="decimal" value={r.cantidad} onChange={(e) => cambiar(i, { cantidad: e.target.value })} />
                    {m ? <div style={{ fontSize: 12, color: "var(--apagado)" }}>{m.purchaseUnit}</div> : null}
                  </td>
                  <td className="num">
                    <input
                      className="entrada" style={{ width: 120 }} aria-label={`Precio ${i + 1}`} inputMode="decimal"
                      placeholder={m ? (m.purchasePriceCents / 100).toFixed(2) : ""}
                      value={r.costo} onChange={(e) => cambiar(i, { costo: e.target.value })}
                    />
                    {m && m.purchasePriceCents === 0 && r.costo.trim() === "" ? (
                      <div style={{ fontSize: 12, color: "var(--ambar)" }}>sin precio en el catálogo</div>
                    ) : null}
                  </td>
                  <td>
                    {renglones.length > 1 ? (
                      <button type="button" className="boton hueco" style={{ minHeight: 36, padding: "6px 12px" }} onClick={() => setRenglones((rs) => rs.filter((_, j) => j !== i))}>
                        Quitar
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr><td colSpan={2}>Total de la compra</td><td className="num">{money(total)}</td><td /></tr>
          </tfoot>
        </table>
      </div>

      <div className="fila" style={{ gap: 12, flexWrap: "wrap" }}>
        <button type="button" className="boton hueco" onClick={() => setRenglones((rs) => [...rs, { materialId: "", cantidad: "", costo: "" }])}>
          Agregar otro material
        </button>
        <button type="button" className="boton" disabled={!listo || ocupado} onClick={crear}>Pedir compra</button>
      </div>
      <Falla texto={falla} />
    </div>
  );
}

interface RenglonCompra {
  id: string;
  materialId: string;
  description: string;
  purchaseUnit: string;
  contentPerPurchaseMilli: number;
  quantityMilli: number;
  unitCostCents: number;
  recibidoMilli: number;
  pendienteMilli: number;
  subtotalCents: number;
}
interface RecepcionVista {
  id: string;
  number: number;
  receivedOn: string;
  documentRef: string | null;
  annulledAt: string | null;
  annulReason: string | null;
  totalCents: number;
  lines: { purchaseLineId: string; description: string; purchaseUnit: string; quantityMilli: number; costCents: number }[];
}
interface CompraDetalle {
  id: string;
  number: number;
  orderedOn: string;
  documentRef: string | null;
  notes: string | null;
  status: string;
  cancelReason: string | null;
  estado: string;
  supplier: Proveedor | null;
  lines: RenglonCompra[];
  totalCents: number;
  recibidoCents: number;
  receipts: RecepcionVista[];
}

function FichaCompra() {
  const { id } = useParams();
  const { dato, error, cargando, recargar } = useApi<CompraDetalle>(id ? `/bloques/compras/${id}` : null);
  const { puede } = useEscribe();
  const [llegó, setLlegó] = useState<Record<string, string>>({});
  const [precios, setPrecios] = useState<Record<string, string>>({});
  const [ref, setRef] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);

  if (cargando && !dato) return <Cargando que="la compra" />;
  if (error) return <Fallo error={error} />;
  if (!dato) return null;
  const c = dato;
  const e = ESTADO_COMPRA[c.estado] ?? { texto: c.estado, clase: "hueca" };
  // Una compra completa ya no espera nada: ni se recibe ni se cancela.
  const abierta = c.status === "abierta" && c.estado !== "completa";

  const aRecibir = c.lines.filter((l) => Number.isFinite(numero(llegó[l.id] ?? "")) && numero(llegó[l.id] ?? "") > 0);

  async function recibir() {
    if (aRecibir.length === 0 || ocupado) return;
    setOcupado(true);
    setFalla(null);
    try {
      const r = await api.post<{ avisos?: string[] }>(`/bloques/compras/${c.id}/recepciones`, {
        ...(ref.trim() ? { documentRef: ref.trim() } : {}),
        lines: aRecibir.map((l) => ({
          purchaseLineId: l.id,
          quantityMilli: aMilli(llegó[l.id] ?? ""),
          ...((precios[l.id] ?? "").trim() !== "" && Number.isFinite(numero(precios[l.id] ?? "")) ? { unitCostCents: aCentavos(precios[l.id] ?? "") } : {}),
        })),
      });
      setAvisos(r.avisos ?? []);
      setLlegó({});
      setPrecios({});
      setRef("");
      recargar();
    } catch (err) {
      setFalla(mensaje(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="pila" style={{ gap: 18 }}>
      <Link to="/almacen/compras" className="lbl" style={{ textDecoration: "none" }}>← Compras</Link>
      <div className="fila" style={{ gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
        <h2 className="titulo" style={{ fontSize: 26 }}>Compra N° {c.number}</h2>
        <span className={`insignia ${e.clase}`}>{e.texto}</span>
      </div>
      <div style={{ color: "var(--apagado)" }}>
        {c.supplier?.name ?? "Proveedor"} · pedida el {fecha(c.orderedOn)}
        {c.documentRef ? ` · ${c.documentRef}` : ""}
      </div>
      {c.status === "cancelada" ? (
        <div className="aviso"><IconoInfo /><span>Cancelada: {c.cancelReason}</span></div>
      ) : null}
      <Avisos lista={avisos} />

      <div className="tarjeta envoltura-tabla">
        <table className="tabla">
          <thead>
            <tr>
              <th>Material</th>
              <th className="num">Pedido</th>
              <th className="num">Llegó</th>
              <th className="num">Falta</th>
              <th className="num">Precio</th>
              <th className="num">Subtotal</th>
              {abierta && puede ? <><th className="num">Llega ahora</th><th className="num">A otro precio</th></> : null}
            </tr>
          </thead>
          <tbody>
            {c.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  <strong>{l.description}</strong>
                  <div style={{ fontSize: 12, color: "var(--apagado)" }}>{l.purchaseUnit}</div>
                </td>
                <td className="num">{milli(l.quantityMilli)}</td>
                <td className="num">{milli(l.recibidoMilli)}</td>
                <td className="num">{milli(l.pendienteMilli)}</td>
                <td className="num">{money(l.unitCostCents)}</td>
                <td className="num">{money(l.subtotalCents)}</td>
                {abierta && puede ? (
                  <>
                    <td className="num">
                      <input className="entrada" style={{ width: 96 }} aria-label={`Llega ${l.description}`} inputMode="decimal"
                        value={llegó[l.id] ?? ""} onChange={(ev) => setLlegó({ ...llegó, [l.id]: ev.target.value })} />
                    </td>
                    <td className="num">
                      <input className="entrada" style={{ width: 96 }} aria-label={`Precio real ${l.description}`} inputMode="decimal"
                        placeholder={(l.unitCostCents / 100).toFixed(2)}
                        value={precios[l.id] ?? ""} onChange={(ev) => setPrecios({ ...precios, [l.id]: ev.target.value })} />
                    </td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>Total · recibido {money(c.recibidoCents)}</td>
              <td className="num">{money(c.totalCents)}</td>
              {abierta && puede ? <td colSpan={2} /> : null}
            </tr>
          </tfoot>
        </table>
      </div>

      {abierta && puede ? (
        <div className="tarjeta" style={{ padding: 18 }}>
          <div className="fila" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Campo etiqueta="N° de remisión o factura del proveedor (opcional)">
              <input className="entrada" aria-label="N° de remisión" value={ref} onChange={(ev) => setRef(ev.target.value)} />
            </Campo>
            <button
              type="button" className="boton hueco"
              onClick={() => setLlegó(Object.fromEntries(c.lines.filter((l) => l.pendienteMilli > 0).map((l) => [l.id, String(l.pendienteMilli / 1000)])))}
            >
              Llegó todo lo que faltaba
            </button>
            <button type="button" className="boton" disabled={aRecibir.length === 0 || ocupado} onClick={recibir}>
              Anotar que llegó
            </button>
          </div>
          <Falla texto={falla} />
        </div>
      ) : null}

      {c.receipts.length > 0 ? (
        <div className="pila" style={{ gap: 10 }}>
          <span className="lbl">Recepciones</span>
          {c.receipts.map((r) => (
            <div key={r.id} className="tarjeta" style={{ padding: 14, opacity: r.annulledAt ? 0.6 : 1 }}>
              <div className="fila" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <span>
                  <strong>Recepción {r.number}</strong> · {fecha(r.receivedOn)}
                  {r.documentRef ? ` · ${r.documentRef}` : ""} · {money(r.totalCents)}
                </span>
                {r.annulledAt ? (
                  <span style={{ color: "var(--apagado)" }}>Anulada: {r.annulReason}</span>
                ) : puede ? (
                  <ConMotivo
                    etiqueta="Anular recepción"
                    confirmar="Sí, anular"
                    ayuda="Lo que entró vuelve a salir del almacén."
                    alConfirmar={async (reason) => {
                      const x = await api.post<{ avisos?: string[] }>(`/bloques/recepciones/${r.id}/anular`, { reason });
                      setAvisos(x.avisos ?? []);
                      recargar();
                    }}
                  />
                ) : null}
              </div>
              <div style={{ fontSize: 14, color: "var(--apagado)", marginTop: 6 }}>
                {r.lines.map((l) => `${milli(l.quantityMilli)} ${l.purchaseUnit} de ${l.description}`).join(" · ")}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {abierta && puede ? (
        <div>
        <ConMotivo
          etiqueta="Cancelar la compra"
          confirmar="Sí, cancelar"
          ayuda="Lo que ya llegó se queda en el almacén."
          alConfirmar={async (reason) => {
            const x = await api.post<{ avisos?: string[] }>(`/bloques/compras/${c.id}/cancelar`, { reason });
            setAvisos(x.avisos ?? []);
            recargar();
          }}
        />
        </div>
      ) : null}
    </div>
  );
}

// --- Conteos ---------------------------------------------------------------

interface ConteoFila {
  id: string;
  number: number;
  status: "abierto" | "aprobado" | "cancelado";
  notes: string | null;
  createdAt: string;
  renglones: number;
  contados: number;
}

const ESTADO_CONTEO: Record<string, { texto: string; clase: string }> = {
  abierto: { texto: "Abierto", clase: "aviso" },
  aprobado: { texto: "Aprobado", clase: "cumple" },
  cancelado: { texto: "Cancelado", clase: "hueca" },
};

function Conteos() {
  const nav = useNavigate();
  const { dato, error, cargando } = useApi<ConteoFila[]>("/bloques/conteos");
  const { puede } = useEscribe();
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);

  if (cargando) return <Cargando que="los conteos" />;
  if (error) return <Fallo error={error} />;
  const filas = dato ?? [];

  async function abrir() {
    setOcupado(true);
    setFalla(null);
    try {
      const r = await api.post<{ id: string }>("/bloques/conteos", {});
      nav(`/almacen/conteos/${r.id}`);
    } catch (e) {
      setFalla(mensaje(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <div className="fila" style={{ justifyContent: "space-between", marginBottom: 16, gap: 16, flexWrap: "wrap" }}>
        <span style={{ color: "var(--apagado)" }}>
          Contar de verdad lo que hay en la bodega y corregir el sistema con la diferencia.
        </span>
        {puede ? <button type="button" className="boton" disabled={ocupado} onClick={abrir}>Abrir un conteo</button> : null}
      </div>
      <Falla texto={falla} />
      {filas.length === 0 ? (
        <div className="aviso"><IconoInfo /><span>Todavía no se ha hecho ningún conteo.</span></div>
      ) : (
        <div className="tarjeta envoltura-tabla">
          <table className="tabla">
            <thead><tr><th>N°</th><th>Abierto</th><th>Estado</th><th className="num">Contados</th></tr></thead>
            <tbody>
              {filas.map((c) => {
                const e = ESTADO_CONTEO[c.status] ?? { texto: c.status, clase: "hueca" };
                return (
                  <tr key={c.id}>
                    <td><Link to={`/almacen/conteos/${c.id}`}>Conteo {c.number}</Link></td>
                    <td className="c-nw">{fecha(c.createdAt)}</td>
                    <td><span className={`insignia ${e.clase}`}>{e.texto}</span></td>
                    <td className="num">{c.contados} de {c.renglones}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

interface LineaConteo {
  id: string;
  materialId: string;
  description: string;
  unitAbbreviation: string;
  expectedMilli: number;
  countedMilli: number | null;
  note: string | null;
  diferenciaMilli: number | null;
  movimientoDesdeElCorteMilli: number;
}
interface ConteoDetalle {
  id: string;
  number: number;
  status: "abierto" | "aprobado" | "cancelado";
  notes: string | null;
  createdAt: string;
  lines: LineaConteo[];
}

function FichaConteo() {
  const { id } = useParams();
  const { dato, error, cargando, recargar } = useApi<ConteoDetalle>(id ? `/bloques/conteos/${id}` : null);
  const { puede, duena } = useEscribe();
  const [cambios, setCambios] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);

  if (cargando && !dato) return <Cargando que="el conteo" />;
  if (error) return <Fallo error={error} />;
  if (!dato) return null;
  const c = dato;
  const abierto = c.status === "abierto";
  const e = ESTADO_CONTEO[c.status] ?? { texto: c.status, clase: "hueca" };

  const pendientes = Object.entries(cambios).filter(([lid, t]) => {
    const n = numero(t);
    const l = c.lines.find((x) => x.id === lid);
    return Number.isFinite(n) && n >= 0 && l && aMilli(t) !== l.countedMilli;
  });

  async function guardar(): Promise<boolean> {
    if (pendientes.length === 0) return true;
    setOcupado(true);
    setFalla(null);
    try {
      await api.patch(`/bloques/conteos/${c.id}/lineas`, {
        lines: pendientes.map(([lid, t]) => ({ id: lid, countedMilli: aMilli(t) })),
      });
      setCambios({});
      recargar();
      return true;
    } catch (err) {
      setFalla(mensaje(err));
      return false;
    } finally {
      setOcupado(false);
    }
  }

  const contados = c.lines.filter((l) => l.countedMilli !== null).length;

  return (
    <div className="pila" style={{ gap: 18 }}>
      <Link to="/almacen/conteos" className="lbl" style={{ textDecoration: "none" }}>← Conteos</Link>
      <div className="fila" style={{ gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
        <h2 className="titulo" style={{ fontSize: 26 }}>Conteo físico N° {c.number}</h2>
        <span className={`insignia ${e.clase}`}>{e.texto}</span>
      </div>
      <div style={{ color: "var(--apagado)" }}>
        Abierto el {fecha(c.createdAt)} · {contados} de {c.lines.length} materiales contados.
        {abierto ? " Lo que no cuentes no se toca." : ""}
      </div>
      <Avisos lista={avisos} />

      <div className="tarjeta envoltura-tabla">
        <table className="tabla">
          <thead>
            <tr>
              <th>Material</th>
              <th className="num">El sistema decía</th>
              <th className="num">Contaste</th>
              <th className="num">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {c.lines.map((l) => {
              const escrito = cambios[l.id];
              const dif = escrito !== undefined && Number.isFinite(numero(escrito)) ? aMilli(escrito) - l.expectedMilli : l.diferenciaMilli;
              return (
                <tr key={l.id}>
                  <td>
                    <strong>{l.description}</strong>
                    {l.movimientoDesdeElCorteMilli !== 0 ? (
                      <div style={{ fontSize: 12, color: "var(--ambar)" }}>
                        Desde que se abrió el conteo {l.movimientoDesdeElCorteMilli > 0 ? "entraron" : "salieron"}{" "}
                        {cantidad(Math.abs(l.movimientoDesdeElCorteMilli), l.unitAbbreviation)}. Solo se ajusta la diferencia.
                      </div>
                    ) : null}
                  </td>
                  <td className="num">{cantidad(l.expectedMilli, l.unitAbbreviation)}</td>
                  <td className="num">
                    {abierto && puede ? (
                      <input
                        className="entrada" style={{ width: 110 }} inputMode="decimal"
                        aria-label={`Contado ${l.description}`}
                        value={escrito ?? (l.countedMilli !== null ? String(l.countedMilli / 1000) : "")}
                        onChange={(ev) => setCambios({ ...cambios, [l.id]: ev.target.value })}
                      />
                    ) : l.countedMilli !== null ? cantidad(l.countedMilli, l.unitAbbreviation) : "—"}
                  </td>
                  <td className="num" style={dif ? { color: dif < 0 ? "var(--falla)" : "var(--cumple)" } : undefined}>
                    {dif === null ? "—" : dif === 0 ? "igual" : `${dif > 0 ? "+" : ""}${cantidad(dif, l.unitAbbreviation)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {abierto && puede ? (
        <div className="fila" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <button type="button" className="boton hueco" disabled={pendientes.length === 0 || ocupado} onClick={() => void guardar()}>
            Guardar lo contado
          </button>
          {duena ? (
            <button
              type="button" className="boton" disabled={ocupado || (contados === 0 && pendientes.length === 0)}
              onClick={async () => {
                if (!(await guardar())) return;
                setOcupado(true);
                try {
                  const r = await api.post<{ avisos?: string[] }>(`/bloques/conteos/${c.id}/aprobar`, {});
                  setAvisos(r.avisos ?? []);
                  recargar();
                } catch (err) {
                  setFalla(mensaje(err));
                } finally {
                  setOcupado(false);
                }
              }}
            >
              Aprobar y corregir el almacén
            </button>
          ) : (
            <span style={{ color: "var(--apagado)", alignSelf: "center" }}>Solo la dueña puede aprobar el conteo.</span>
          )}
          <ConMotivo
            etiqueta="Cancelar el conteo"
            confirmar="Sí, cancelar"
            alConfirmar={async (reason) => {
              await api.post(`/bloques/conteos/${c.id}/cancelar`, { reason });
              recargar();
            }}
          />
        </div>
      ) : null}
      <Falla texto={falla} />
    </div>
  );
}

// --- Proveedores -----------------------------------------------------------

function Proveedores() {
  const { dato, error, cargando, recargar } = useApi<Proveedor[]>("/bloques/proveedores");
  const { puede } = useEscribe();
  const [nombre, setNombre] = useState("");
  const [nit, setNit] = useState("");
  const [tel, setTel] = useState("");
  const [correo, setCorreo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);

  if (cargando && !dato) return <Cargando que="los proveedores" />;
  if (error) return <Fallo error={error} />;

  async function crear() {
    if (!nombre.trim() || ocupado) return;
    setOcupado(true);
    setFalla(null);
    try {
      await api.post("/bloques/proveedores", { name: nombre.trim(), nit, phone: tel, email: correo });
      setNombre(""); setNit(""); setTel(""); setCorreo("");
      recargar();
    } catch (e) {
      setFalla(mensaje(e));
    } finally {
      setOcupado(false);
    }
  }

  async function alternar(p: Proveedor) {
    try {
      await api.patch(`/bloques/proveedores/${p.id}`, { active: !p.active });
      recargar();
    } catch (e) {
      setFalla(mensaje(e));
    }
  }

  const filas: Proveedor[] = dato ?? [];

  return (
    <div className="pila" style={{ gap: 18 }}>
      {puede ? (
        <div className="tarjeta" style={{ padding: 18 }}>
          <div className="rejilla" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
            <Campo etiqueta="Nombre"><input className="entrada" aria-label="Nombre del proveedor" value={nombre} onChange={(e) => setNombre(e.target.value)} /></Campo>
            <Campo etiqueta="NIT (opcional)"><input className="entrada" aria-label="NIT del proveedor" value={nit} onChange={(e) => setNit(e.target.value)} /></Campo>
            <Campo etiqueta="Teléfono (opcional)"><input className="entrada" aria-label="Teléfono del proveedor" value={tel} onChange={(e) => setTel(e.target.value)} /></Campo>
            <Campo etiqueta="Correo (opcional)"><input className="entrada" aria-label="Correo del proveedor" value={correo} onChange={(e) => setCorreo(e.target.value)} /></Campo>
          </div>
          <div style={{ marginTop: 14 }}>
            <button type="button" className="boton" disabled={!nombre.trim() || ocupado} onClick={crear}>Agregar proveedor</button>
          </div>
          <Falla texto={falla} />
        </div>
      ) : null}

      {filas.length === 0 ? (
        <div className="aviso"><IconoInfo /><span>Todavía no hay proveedores.</span></div>
      ) : (
        <div className="tarjeta envoltura-tabla">
          <table className="tabla">
            <thead><tr><th>Proveedor</th><th>Contacto</th><th /></tr></thead>
            <tbody>
              {filas.map((p) => (
                <tr key={p.id} style={p.active ? undefined : { opacity: 0.55 }}>
                  <td><strong>{p.name}</strong>{p.nit ? <div style={{ fontSize: 13, color: "var(--apagado)" }}>NIT {p.nit}</div> : null}</td>
                  <td style={{ color: "var(--apagado)" }}>{[p.phone, p.email].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="num">
                    {puede ? (
                      <button type="button" className="boton hueco" style={{ minHeight: 36, padding: "6px 12px" }} onClick={() => void alternar(p)}>
                        {p.active ? "Inactivar" : "Reactivar"}
                      </button>
                    ) : p.active ? null : "Inactivo"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
